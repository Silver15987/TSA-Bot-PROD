import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { database } from '../database/client';
import { permissionService } from '../modules/admin/services/permissionService';
import { coinCalculator } from '../modules/voiceTracking/services/coinCalculator';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('remove-hours')
    .setDescription('Manually remove VC time from a user (Staff only)')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to remove VC time from')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('minutes')
        .setDescription('Amount of VC time to remove (in minutes)')
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(option =>
      option
        .setName('date')
        .setDescription('Date the time should be deducted for (YYYY-MM-DD, UTC)')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({
          content: '❌ This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const member = interaction.member;

      if (!member || typeof (member as any).permissions === 'string') {
        await interaction.reply({
          content: '❌ Unable to verify permissions.',
          ephemeral: true,
        });
        return;
      }

      const permissionCheck = permissionService.hasStaffPermission(member as any, guildId);
      if (!permissionCheck.hasPermission) {
        await interaction.reply({
          content: `❌ ${permissionCheck.reason}`,
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const targetUser = interaction.options.getUser('user', true);
      const minutes = interaction.options.getInteger('minutes', true);
      const dateInput = interaction.options.getString('date', true).trim();

      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateInput)) {
        await interaction.editReply({
          content: '❌ Invalid date format. Please use `YYYY-MM-DD` (UTC).',
        });
        return;
      }

      const creditedAt = new Date(`${dateInput}T00:00:00.000Z`);
      if (Number.isNaN(creditedAt.getTime())) {
        await interaction.editReply({
          content: '❌ Could not parse the provided date. Please check the format.',
        });
        return;
      }

      const [year, month, day] = dateInput.split('-').map(Number);
      if (
        creditedAt.getUTCFullYear() !== year ||
        creditedAt.getUTCMonth() + 1 !== month ||
        creditedAt.getUTCDate() !== day
      ) {
        await interaction.editReply({
          content: '❌ Invalid date. Please provide a valid calendar date.',
        });
        return;
      }

      const durationMs = minutes * 60 * 1000;

      const userDoc = await database.users.findOne({ id: targetUser.id, guildId });
      if (!userDoc) {
        await interaction.editReply({
          content: '❌ User not found in the database.',
        });
        return;
      }

      const coinsToRemove = await coinCalculator.calculateCoins(durationMs, guildId, targetUser.id);

      const balanceBefore = userDoc.coins;
      const coinsDelta = Math.min(coinsToRemove, balanceBefore);
      const balanceAfter = balanceBefore - coinsDelta;

      const newTotalVcTime = Math.max(0, (userDoc.totalVcTime || 0) - durationMs);
      const newTotalCoinsEarned = Math.max(0, (userDoc.totalCoinsEarned || 0) - coinsToRemove);

      const updateResult = await database.users.updateOne(
        { id: targetUser.id, guildId },
        {
          $set: {
            totalVcTime: newTotalVcTime,
            totalCoinsEarned: newTotalCoinsEarned,
            coins: balanceAfter,
            updatedAt: new Date(),
          },
        }
      );

      if (updateResult.modifiedCount === 0) {
        await interaction.editReply({
          content: '❌ Failed to update user record. No changes were made.',
        });
        return;
      }

      const transactionId = `tx_manual_remove_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      try {
        await database.transactions.insertOne({
          id: transactionId,
          userId: targetUser.id,
          type: 'vctime_earn',
          amount: -coinsDelta,
          balanceAfter,
          metadata: {
            durationRemoved: durationMs,
            channelId: null,
            factionId: null,
            guildId,
            source: 'manual_remove_hours',
            creditedAt,
            staffUserId: interaction.user.id,
          },
          createdAt: creditedAt,
        });
      } catch (error) {
        logger.error(
          `Failed to create manual remove transaction ${transactionId} for user ${targetUser.id}:`,
          error
        );
      }

      const embed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle('✅ VC Time Manually Removed')
        .setDescription(`Removed **${minutes}** minutes of VC time from ${targetUser}`)
        .addFields(
          { name: '🕒 Duration Removed', value: `${minutes} minutes`, inline: true },
          { name: '📅 Date (UTC)', value: dateInput, inline: true },
          { name: '💰 Coins Deducted', value: `-${coinsDelta.toLocaleString()}`, inline: true },
          { name: '💵 Balance Before', value: `${balanceBefore.toLocaleString()} coins`, inline: true },
          { name: '💰 Balance After', value: `${balanceAfter.toLocaleString()} coins`, inline: true },
        )
        .setFooter({ text: `Staff: ${interaction.user.username}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      await sendAuditLog(interaction, {
        type: 'remove',
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
        minutes,
        coinsDelta: -coinsDelta,
        balanceBefore,
        balanceAfter,
        dateInput,
      });

      logger.info(
        `Staff ${interaction.user.id} manually removed ${minutes} minutes (${durationMs} ms) of VC time ` +
        `from user ${targetUser.id} in guild ${guildId}, coinsRemoved=${coinsDelta}, ` +
        `balance: ${balanceBefore} -> ${balanceAfter}`
      );
    } catch (error) {
      logger.error('Error in remove-hours command:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ An unexpected error occurred while removing hours.',
        });
      } else {
        await interaction.reply({
          content: '❌ An unexpected error occurred while removing hours.',
          ephemeral: true,
        });
      }
    }
  },
};

async function sendAuditLog(
  interaction: ChatInputCommandInteraction,
  data: {
    type: 'remove';
    targetUserId: string;
    targetUsername: string;
    minutes: number;
    coinsDelta: number;
    balanceBefore: number;
    balanceAfter: number;
    dateInput: string;
  }
): Promise<void> {
  try {
    const guildId = interaction.guildId!;
    const channelId = permissionService.getAuditLogChannelId(guildId);
    if (!channelId) return;

    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('Staff Manual Hours Removed')
      .setDescription(`<@${data.targetUserId}> (${data.targetUsername})`)
      .addFields(
        { name: 'Minutes Removed', value: `${data.minutes}`, inline: true },
        { name: 'Coins Delta', value: `${data.coinsDelta.toLocaleString()}`, inline: true },
        { name: 'Date (UTC)', value: data.dateInput, inline: true },
        { name: 'Balance Before', value: data.balanceBefore.toLocaleString(), inline: true },
        { name: 'Balance After', value: data.balanceAfter.toLocaleString(), inline: true },
        { name: 'Staff', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setTimestamp();

    await (channel as any).send({ embeds: [embed] });
  } catch (error) {
    logger.warn('Failed to send audit log for remove-hours:', error);
  }
}
