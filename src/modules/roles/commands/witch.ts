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
import { factionManager } from '../../factions/services/factionManager';

export default {
  data: new SlashCommandBuilder()
    .setName('witch')
    .setDescription('Witch role abilities')
    .addSubcommand(subcommand =>
      subcommand
        .setName('curse')
        .setDescription('Cast a curse on a user or faction')
        .addStringOption(option =>
          option
            .setName('target')
            .setDescription('User mention or faction name')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('type')
            .setDescription('Curse type')
            .setRequired(true)
            .addChoices(
              { name: 'Earning Rate Reduction', value: 'earning_rate' },
              { name: 'Instant Loss', value: 'instant_loss' }
            )
        )
        .addIntegerOption(option =>
          option
            .setName('amount')
            .setDescription('Amount (% reduction for earning_rate, coins lost for instant_loss)')
            .setRequired(true)
            .setMinValue(1)
        )
        .addIntegerOption(option =>
          option
            .setName('cost')
            .setDescription('Coins to spend on curse (affects curse strength)')
            .setRequired(true)
            .setMinValue(1)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.user.id;
      const guildId = interaction.guildId!;

      // Verify user has Witch role
      const role = await roleManager.getUserRole(userId, guildId);
      if (role !== 'witch') {
        await interaction.editReply({
          content: '❌ You must be a Witch to use this command.',
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'curse') {
        await handleCurse(interaction, userId, guildId);
      }
    } catch (error) {
      logger.error('Error in witch command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while processing your request.',
      });
    }
  },
};

async function handleCurse(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const targetInput = interaction.options.getString('target', true);
  const curseType = interaction.options.getString('type', true) as 'earning_rate' | 'instant_loss';
  const amount = interaction.options.getInteger('amount', true);
  const cost = interaction.options.getInteger('cost', true);

  // Check if witch already has an active curse
  const activeCurses = await roleStatusManager.getActiveStatusesByUser(
    userId,
    guildId,
    'curse'
  );

  if (activeCurses.length > 0) {
    const oldestCurse = activeCurses[0];
    const expiresAt = oldestCurse.expiresAt;
    
    if (expiresAt && new Date() < expiresAt) {
      const timeRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60));
      await interaction.editReply({
        content: `❌ You can only maintain one curse at a time. Your current curse expires in ${timeRemaining} hours.`,
      });
      return;
    }
  }

  // Get witch user data
  const witch = await database.users.findOne({ id: userId, guildId });
  if (!witch) {
    await interaction.editReply({
      content: '❌ User not found.',
    });
    return;
  }

  // Check if witch has enough coins
  if (witch.coins < cost) {
    await interaction.editReply({
      content: `❌ Insufficient coins! You need ${cost.toLocaleString()} coins but only have ${witch.coins.toLocaleString()} coins.`,
    });
    return;
  }

  // Calculate curse strength based on coins spent
  // Base strength scales with cost: higher cost = stronger curse
  // Also consider faction deposit if witch is in a faction
  let curseStrength = cost;
  if (witch.currentFaction) {
    const faction = await database.factions.findOne({
      id: witch.currentFaction,
      guildId,
    });
    if (faction) {
      // Add a portion of faction deposit to curse strength (max 50% contribution)
      const factionContribution = Math.min(faction.treasury * 0.1, cost * 0.5);
      curseStrength += factionContribution;
    }
  }

  // Parse target (user mention or faction name)
  const targetMatch = targetInput.match(/<@!?(\d+)>/);
  let targetUserId: string | undefined;
  let targetFactionId: string | undefined;

  if (targetMatch) {
    // User target
    targetUserId = targetMatch[1];
    
    const targetUser = await database.users.findOne({ id: targetUserId, guildId });
    if (!targetUser) {
      await interaction.editReply({
        content: '❌ Target user not found.',
      });
      return;
    }

    // For instant_loss curse, check if target has enough coins
    if (curseType === 'instant_loss' && targetUser.coins < amount) {
      await interaction.editReply({
        content: `❌ Target only has ${targetUser.coins.toLocaleString()} coins. Cannot curse for ${amount.toLocaleString()} coins.`,
      });
      return;
    }
  } else {
    // Faction target
    const faction = await factionManager.getFactionByName(targetInput, guildId);
    if (!faction) {
      await interaction.editReply({
        content: `❌ Faction "${targetInput}" not found.`,
      });
      return;
    }
    targetFactionId = faction.id;

    // For instant_loss curse on faction, check if faction has enough coins
    if (curseType === 'instant_loss' && faction.treasury < amount) {
      await interaction.editReply({
        content: `❌ Faction only has ${faction.treasury.toLocaleString()} coins. Cannot curse for ${amount.toLocaleString()} coins.`,
      });
      return;
    }
  }

  // Apply curse duration (base 12 hours, can be increased based on curse strength)
  const baseDurationHours = 12;
  const durationHours = baseDurationHours + Math.floor(curseStrength / 1000); // Can exceed 12 hours with higher strength
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

  // Apply instant loss immediately if curse type is instant_loss
  if (curseType === 'instant_loss') {
    if (targetUserId) {
      // Deduct from user
      await database.users.updateOne(
        { id: targetUserId, guildId },
        { $inc: { coins: -amount }, $set: { updatedAt: new Date() } }
      );
    } else if (targetFactionId) {
      // Deduct from faction treasury
      await database.factions.updateOne(
        { id: targetFactionId, guildId },
        { $inc: { treasury: -amount }, $set: { updatedAt: new Date() } }
      );
    }
  }

  // Apply curse status
  const statusId = await roleStatusManager.applyStatus({
    guildId,
    userId,
    targetUserId,
    targetFactionId,
    roleType: 'witch',
    effectType: 'curse',
    expiresAt,
    metadata: {
      curseType,
      amount,
      cost,
      curseStrength,
      castAt: new Date(),
    },
  });

  if (!statusId) {
    await interaction.editReply({
      content: '❌ Failed to apply curse.',
    });
    return;
  }

  // Deduct cost from witch
  await roleAbilityService.deductCost(userId, guildId, cost);

  // Log action
  await roleAbilityService.logAbilityUse(
    userId,
    guildId,
    'witch',
    'curse',
    true,
    targetUserId,
    targetFactionId,
    amount,
    {
      curseType,
      cost,
      curseStrength,
      durationHours,
    }
  );

  // Log transaction for curse cost
  const newBalance = witch.coins - cost;
  await database.transactions.insertOne({
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
    userId,
    type: 'role_ability',
    amount: -cost,
    balanceAfter: newBalance,
    metadata: {
      roleType: 'witch',
      abilityName: 'curse',
      guildId,
    },
    createdAt: new Date(),
  });

  // Build success message
  const targetDisplay = targetUserId 
    ? `<@${targetUserId}>` 
    : `faction "${targetInput}"`;
  
  const curseDescription = curseType === 'earning_rate'
    ? `Earning rate reduced by ${amount}% for ${durationHours} hours`
    : `Lost ${amount.toLocaleString()} coins instantly (curse active for ${durationHours} hours)`;

  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji('witch')} Curse Cast`)
    .setDescription(`You have successfully cast a curse on ${targetDisplay}!\n\n**Effect:** ${curseDescription}\n**Curse Strength:** ${Math.floor(curseStrength).toLocaleString()}\n**Cost:** ${cost.toLocaleString()} coins`)
    .setColor(0x9b59b6)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
