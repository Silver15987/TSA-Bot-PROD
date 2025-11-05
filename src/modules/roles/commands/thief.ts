import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { database } from '../../../database/client';
import logger from '../../../core/logger';
import { roleManager } from '../services/roleManager';
import { roleAbilityService } from '../services/roleAbilityService';
import { roleStatusManager } from '../services/roleStatusManager';
import { getRoleEmoji } from '../utils/formatters';

export default {
  data: new SlashCommandBuilder()
    .setName('thief')
    .setDescription('Thief role abilities')
    .addSubcommand(subcommand =>
      subcommand
        .setName('steal')
        .setDescription('Attempt to steal coins from a user or faction')
        .addStringOption(option =>
          option
            .setName('target')
            .setDescription('User mention or faction name')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName('amount')
            .setDescription('Amount of coins to steal')
            .setRequired(true)
            .setMinValue(1)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.user.id;
      const guildId = interaction.guildId!;

      // Verify user has Thief role
      const role = await roleManager.getUserRole(userId, guildId);
      if (role !== 'thief') {
        await interaction.editReply({
          content: '❌ You must be a Thief to use this command.',
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'steal') {
        await handleSteal(interaction, userId, guildId);
      }
    } catch (error) {
      logger.error('Error in thief command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while processing your request.',
      });
    }
  },
};

async function handleSteal(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const targetInput = interaction.options.getString('target', true);
  const amount = interaction.options.getInteger('amount', true);

  // Calculate success rate (base 50% - amount/1000)
  const baseRate = 50;
  const amountPenalty = amount / 1000;
  let successRate = Math.max(0, baseRate - amountPenalty);

  // Check for Guard protection (simplified - would need to check actual protected targets)
  // For now, just use base rate

  // Roll for success
  const success = roleAbilityService.rollSuccess(successRate);

  // Parse target
  const targetMatch = targetInput.match(/<@!?(\d+)>/);
  let targetUserId: string | undefined;

  if (targetMatch) {
    targetUserId = targetMatch[1];
  } else {
    // Assume faction name (would need faction lookup)
    await interaction.editReply({
      content: '❌ Faction stealing not yet implemented. Please target a user.',
    });
    return;
  }

  if (!targetUserId) {
    await interaction.editReply({
      content: '❌ Invalid target.',
    });
    return;
  }

  const targetUser = await database.users.findOne({ id: targetUserId, guildId });
  if (!targetUser) {
    await interaction.editReply({
      content: '❌ Target user not found.',
    });
    return;
  }

  // Check if target has coins
  if (targetUser.coins < amount) {
    await interaction.editReply({
      content: `❌ Target only has ${targetUser.coins.toLocaleString()} coins.`,
    });
    return;
  }

  if (success) {
    // Successful theft
    // Transfer coins
    await database.users.updateOne(
      { id: targetUserId, guildId },
      { $inc: { coins: -amount }, $set: { updatedAt: new Date() } }
    );

    const thief = await database.users.findOne({ id: userId, guildId });
    if (thief) {
      await database.users.updateOne(
        { id: userId, guildId },
        { $inc: { coins: amount }, $set: { updatedAt: new Date() } }
      );
    }

    // Log action
    await roleAbilityService.logAbilityUse(
      userId,
      guildId,
      'thief',
      'steal',
      true,
      targetUserId,
      undefined,
      amount
    );

    const embed = new EmbedBuilder()
      .setTitle(`${getRoleEmoji('thief')} Theft Successful`)
      .setDescription(`You successfully stole ${amount.toLocaleString()} coins from <@${targetUserId}>.`)
      .setColor(0x5865f2)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } else {
    // Failed theft - apply Wanted status
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await roleStatusManager.applyStatus({
      guildId,
      userId,
      roleType: 'thief',
      effectType: 'wanted',
      expiresAt,
      metadata: {
        stealAmount: amount,
        caughtAt: new Date(),
      },
    });

    // Log action
    await roleAbilityService.logAbilityUse(
      userId,
      guildId,
      'thief',
      'steal',
      false,
      targetUserId,
      undefined,
      amount
    );

    const embed = new EmbedBuilder()
      .setTitle(`${getRoleEmoji('thief')} Theft Failed`)
      .setDescription(`Your theft attempt failed! You now have Wanted status for 24 hours (10% coin gain reduction).`)
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
}

