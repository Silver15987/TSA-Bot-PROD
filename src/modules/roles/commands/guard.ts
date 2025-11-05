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
    .setName('guard')
    .setDescription('Guard role abilities')
    .addSubcommand(subcommand =>
      subcommand
        .setName('protect')
        .setDescription('Protect a user or faction for 12 hours')
        .addStringOption(option =>
          option
            .setName('target')
            .setDescription('User mention or faction name')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('bail')
        .setDescription('Remove Wanted status from a Thief')
        .addUserOption(option =>
          option
            .setName('thief')
            .setDescription('The Thief to bail out')
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.user.id;
      const guildId = interaction.guildId!;
      const subcommand = interaction.options.getSubcommand();

      // Verify user has Guard role
      const role = await roleManager.getUserRole(userId, guildId);
      if (role !== 'guard') {
        await interaction.editReply({
          content: '❌ You must be a Guard to use this command.',
        });
        return;
      }

      switch (subcommand) {
        case 'protect':
          await handleProtect(interaction, userId, guildId);
          break;
        case 'bail':
          await handleBail(interaction, userId, guildId);
          break;
        default:
          await interaction.editReply({
            content: '❌ Unknown subcommand',
          });
      }
    } catch (error) {
      logger.error('Error in guard command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while processing your request.',
      });
    }
  },
};

async function handleProtect(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const targetInput = interaction.options.getString('target', true);
  
  // Check if user already has active protection
  const activeProtections = await roleStatusManager.getActiveStatusesByUser(
    userId,
    guildId,
    'protection'
  );

  if (activeProtections.length > 0) {
    await interaction.editReply({
      content: '❌ You can only maintain one protection at a time.',
    });
    return;
  }

  // Parse target (simplified - would need more logic for faction vs user)
  // For now, assume user mention
  const targetMatch = targetInput.match(/<@!?(\d+)>/);
  if (!targetMatch) {
    await interaction.editReply({
      content: '❌ Invalid target. Please mention a user or provide a faction name.',
    });
    return;
  }

  const targetUserId = targetMatch[1];
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours

  // Check ability cooldown and cost
  const canUse = await roleAbilityService.canUseAbility(userId, guildId, 'protect');
  if (!canUse.canUse) {
    await interaction.editReply({
      content: `❌ ${canUse.error || 'Cannot use ability'}`,
    });
    return;
  }

  // Apply protection status
  const statusId = await roleStatusManager.applyStatus({
    guildId,
    userId,
    targetUserId,
    roleType: 'guard',
    effectType: 'protection',
    expiresAt,
    metadata: {
      protectedAt: new Date(),
    },
  });

  if (!statusId) {
    await interaction.editReply({
      content: '❌ Failed to apply protection.',
    });
    return;
  }

  // Set cooldown
  await roleAbilityService.setCooldown(userId, guildId, 'protect', 3);

  // Log action
  await roleAbilityService.logAbilityUse(
    userId,
    guildId,
    'guard',
    'protect',
    true,
    targetUserId
  );

  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji('guard')} Protection Active`)
    .setDescription(`You are now protecting <@${targetUserId}> for 12 hours.`)
    .setColor(0x5865f2)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleBail(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const targetUser = interaction.options.getUser('thief', true);
  const targetUserId = targetUser.id;

  // Check if target has Wanted status
  const wantedStatuses = await roleStatusManager.getActiveStatusesForUser(
    targetUserId,
    guildId,
    'wanted'
  );

  if (wantedStatuses.length === 0) {
    await interaction.editReply({
      content: '❌ This user does not have Wanted status.',
    });
    return;
  }

  const wantedStatus = wantedStatuses[0];
  const stealAmount = wantedStatus.metadata?.stealAmount || 0;

  // Check if Guard's faction has enough coins
  const guard = await database.users.findOne({ id: userId, guildId });
  if (!guard || !guard.currentFaction) {
    await interaction.editReply({
      content: '❌ You must be in a faction to use bail.',
    });
    return;
  }

  const faction = await database.factions.findOne({
    id: guard.currentFaction,
    guildId,
  });

  if (!faction || faction.treasury < stealAmount) {
    await interaction.editReply({
      content: `❌ Your faction does not have enough coins. Required: ${stealAmount.toLocaleString()}`,
    });
    return;
  }

  // Remove Wanted status
  await roleStatusManager.removeStatus(wantedStatus.id);

  // Deduct from faction treasury
  await database.factions.updateOne(
    { id: guard.currentFaction, guildId },
    {
      $inc: { treasury: -stealAmount },
      $set: { updatedAt: new Date() },
    }
  );

  // Log action
  await roleAbilityService.logAbilityUse(
    userId,
    guildId,
    'guard',
    'bail',
    true,
    targetUserId,
    guard.currentFaction,
    stealAmount
  );

  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji('guard')} Bail Successful`)
    .setDescription(`You have bailed out <@${targetUserId}>. ${stealAmount.toLocaleString()} coins deducted from faction treasury.`)
    .setColor(0x5865f2)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

