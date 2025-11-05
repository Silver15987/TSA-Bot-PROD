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
    .setName('merchant')
    .setDescription('Merchant role abilities')
    .addSubcommand(subcommand =>
      subcommand
        .setName('trade')
        .setDescription('Trade coins with another user')
        .addUserOption(option =>
          option.setName('target').setDescription('Target user').setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName('amount')
            .setDescription('Amount of coins to send')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('invest')
        .setDescription('Invest coins for 24 hours (min 10k)')
        .addIntegerOption(option =>
          option
            .setName('amount')
            .setDescription('Amount to invest (minimum 10,000)')
            .setRequired(true)
            .setMinValue(10000)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('market')
        .setDescription('Manipulate server-wide coin-earning rate')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.user.id;
      const guildId = interaction.guildId!;

      // Verify user has Merchant role
      const role = await roleManager.getUserRole(userId, guildId);
      if (role !== 'merchant') {
        await interaction.editReply({
          content: '❌ You must be a Merchant to use this command.',
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      switch (subcommand) {
        case 'trade':
          await handleTrade(interaction, userId, guildId);
          break;
        case 'invest':
          await handleInvest(interaction, userId, guildId);
          break;
        case 'market':
          await handleMarket(interaction, userId, guildId);
          break;
        default:
          await interaction.editReply({
            content: '❌ Unknown subcommand',
          });
      }
    } catch (error) {
      logger.error('Error in merchant command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while processing your request.',
      });
    }
  },
};

async function handleTrade(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const targetUser = interaction.options.getUser('target', true);
  const targetUserId = targetUser.id;
  const amount = interaction.options.getInteger('amount', true);

  // Get merchant data
  const merchant = await database.users.findOne({ id: userId, guildId });
  if (!merchant) {
    await interaction.editReply({
      content: '❌ User not found.',
    });
    return;
  }

  // Check if merchant has enough coins
  if (merchant.coins < amount) {
    await interaction.editReply({
      content: `❌ Insufficient coins! You need ${amount.toLocaleString()} coins but only have ${merchant.coins.toLocaleString()} coins.`,
    });
    return;
  }

  // Get target user data
  const target = await database.users.findOne({ id: targetUserId, guildId });
  if (!target) {
    await interaction.editReply({
      content: '❌ Target user not found.',
    });
    return;
  }

  // Calculate fee (2% goes to merchant)
  const fee = Math.floor(amount * 0.02);
  const targetReceives = amount - fee;

  // Transfer coins
  await database.users.updateOne(
    { id: targetUserId, guildId },
    { $inc: { coins: targetReceives }, $set: { updatedAt: new Date() } }
  );

  await database.users.updateOne(
    { id: userId, guildId },
    { 
      $inc: { coins: -amount + fee }, // Deduct amount sent, but keep fee
      $set: { updatedAt: new Date() } 
    }
  );

  // Log transactions
  const merchantNewBalance = merchant.coins - amount + fee;
  const targetNewBalance = (target.coins || 0) + targetReceives;

  await database.transactions.insertOne({
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
    userId,
    type: 'role_ability',
    amount: -amount + fee,
    balanceAfter: merchantNewBalance,
    metadata: {
      roleType: 'merchant',
      abilityName: 'trade',
      targetUserId,
      fee,
      guildId,
    },
    createdAt: new Date(),
  });

  await database.transactions.insertOne({
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
    userId: targetUserId,
    type: 'role_ability',
    amount: targetReceives,
    balanceAfter: targetNewBalance,
    metadata: {
      roleType: 'merchant',
      abilityName: 'trade_received',
      fromUserId: userId,
      guildId,
    },
    createdAt: new Date(),
  });

  // Log action
  await roleAbilityService.logAbilityUse(
    userId,
    guildId,
    'merchant',
    'trade',
    true,
    targetUserId,
    undefined,
    amount,
    { fee, targetReceives }
  );

  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji('merchant')} Trade Completed`)
    .setDescription(
      `You have traded with <@${targetUserId}>!\n\n` +
      `**Amount Sent:** ${amount.toLocaleString()} coins\n` +
      `**Fee (2%):** ${fee.toLocaleString()} coins (kept by you)\n` +
      `**Target Receives:** ${targetReceives.toLocaleString()} coins\n` +
      `**Your New Balance:** ${merchantNewBalance.toLocaleString()} coins`
    )
    .setColor(0xf39c12)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleInvest(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const amount = interaction.options.getInteger('amount', true);

  // Check minimum investment
  if (amount < 10000) {
    await interaction.editReply({
      content: '❌ Minimum investment is 10,000 coins.',
    });
    return;
  }

  // Get merchant data
  const merchant = await database.users.findOne({ id: userId, guildId });
  if (!merchant) {
    await interaction.editReply({
      content: '❌ User not found.',
    });
    return;
  }

  // Check if merchant has enough coins
  if (merchant.coins < amount) {
    await interaction.editReply({
      content: `❌ Insufficient coins! You need ${amount.toLocaleString()} coins but only have ${merchant.coins.toLocaleString()} coins.`,
    });
    return;
  }

  // Check if merchant already has an active investment
  const activeInvestments = await roleStatusManager.getActiveStatusesByUser(
    userId,
    guildId,
    'investment'
  );

  if (activeInvestments.length > 0) {
    await interaction.editReply({
      content: '❌ You can only have one active investment at a time.',
    });
    return;
  }

  // Apply investment (24 hours duration, +1% return)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const returnAmount = Math.floor(amount * 0.01); // 1% return

  const statusId = await roleStatusManager.applyStatus({
    guildId,
    userId,
    roleType: 'merchant',
    effectType: 'investment',
    expiresAt,
    metadata: {
      amount,
      returnAmount,
      investedAt: new Date(),
    },
  });

  if (!statusId) {
    await interaction.editReply({
      content: '❌ Failed to create investment.',
    });
    return;
  }

  // Deduct investment amount
  await roleAbilityService.deductCost(userId, guildId, amount);

  // Log action
  await roleAbilityService.logAbilityUse(
    userId,
    guildId,
    'merchant',
    'invest',
    true,
    undefined,
    undefined,
    amount,
    { returnAmount, expiresAt }
  );

  // Log transaction
  const newBalance = merchant.coins - amount;
  await database.transactions.insertOne({
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
    userId,
    type: 'role_ability',
    amount: -amount,
    balanceAfter: newBalance,
    metadata: {
      roleType: 'merchant',
      abilityName: 'invest',
      expectedReturn: returnAmount,
      guildId,
    },
    createdAt: new Date(),
  });

  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji('merchant')} Investment Created`)
    .setDescription(
      `You have invested ${amount.toLocaleString()} coins!\n\n` +
      `**Investment Amount:** ${amount.toLocaleString()} coins\n` +
      `**Expected Return:** +${returnAmount.toLocaleString()} coins (1%)\n` +
      `**Duration:** 24 hours\n` +
      `**Warning:** Investment will fail if you are cursed or stolen from!\n\n` +
      `**New Balance:** ${newBalance.toLocaleString()} coins`
    )
    .setColor(0xf39c12)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleMarket(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  // Check ability cooldown (7 days)
  const canUse = await roleAbilityService.canUseAbility(userId, guildId, 'market');
  if (!canUse.canUse) {
    await interaction.editReply({
      content: `❌ ${canUse.error || 'Cannot use ability'}`,
    });
    return;
  }

  // Get merchant data
  const merchant = await database.users.findOne({ id: userId, guildId });
  if (!merchant) {
    await interaction.editReply({
      content: '❌ User not found.',
    });
    return;
  }

  // Random direction (+2% or -2%)
  const isPositive = Math.random() > 0.5;
  const effect = isPositive ? 2 : -2;
  const durationHours = 1;

  // Apply market manipulation status (1 hour duration)
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

  const statusId = await roleStatusManager.applyStatus({
    guildId,
    userId,
    roleType: 'merchant',
    effectType: 'market_manipulation',
    expiresAt,
    metadata: {
      effect,
      isPositive,
      durationHours,
      castAt: new Date(),
    },
  });

  if (!statusId) {
    await interaction.editReply({
      content: '❌ Failed to manipulate market.',
    });
    return;
  }

  // Set cooldown (7 days = 168 hours)
  await roleAbilityService.setCooldown(userId, guildId, 'market', 168);

  // Log action
  await roleAbilityService.logAbilityUse(
    userId,
    guildId,
    'merchant',
    'market',
    true,
    undefined,
    undefined,
    effect,
    { isPositive, durationHours }
  );

  // Notify all users (would need to implement notification system)
  // For now, just show to merchant

  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji('merchant')} Market Manipulation`)
    .setDescription(
      `You have manipulated the server-wide market!\n\n` +
      `**Effect:** ${isPositive ? '+' : ''}${effect}% coin-earning rate\n` +
      `**Duration:** ${durationHours} hour\n` +
      `**Cooldown:** 7 days\n\n` +
      `All users on the server will be affected by this change.`
    )
    .setColor(isPositive ? 0x2ecc71 : 0xe74c3c)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
