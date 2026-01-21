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
    .setName('add-hours')
    .setDescription('Manually add VC time to a user (Staff only)')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to add VC time to')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('minutes')
        .setDescription('Amount of VC time to add (in minutes)')
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(option =>
      option
        .setName('date')
        .setDescription('Date the time should be credited for (YYYY-MM-DD, UTC)')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const guildId = interaction.guildId!;
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

      // Basic date validation: expect YYYY-MM-DD
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

      // Verify the date didn't roll over (e.g., Feb 30 → Mar 1)
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

      // Fetch user document
      const userDoc = await database.users.findOne({ id: targetUser.id, guildId });
      if (!userDoc) {
        await interaction.editReply({
          content: '❌ User not found in the database. They must have used the bot at least once.',
        });
        return;
      }

      // Calculate coins using the same logic as VC tracking (with multipliers)
      const coinsEarned = await coinCalculator.calculateCoins(durationMs, guildId, targetUser.id);

      // Update user aggregates
      const balanceBefore = userDoc.coins;
      const balanceAfter = balanceBefore + coinsEarned;

      const updateResult = await database.users.updateOne(
        { id: targetUser.id, guildId },
        {
          $inc: {
            totalVcTime: durationMs,
            coins: coinsEarned,
            totalCoinsEarned: coinsEarned,
          },
          $set: {
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

      // Create transaction record
      const transactionId = `tx_manual_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      try {
        await database.transactions.insertOne({
          id: transactionId,
          userId: targetUser.id,
          type: 'vctime_earn',
          amount: coinsEarned,
          balanceAfter,
          metadata: {
            duration: durationMs,
            channelId: null,
            factionId: null,
            guildId,
            source: 'manual_add_hours',
            creditedAt,
            staffUserId: interaction.user.id,
          },
          createdAt: creditedAt,
        });
      } catch (error) {
        logger.error(
          `Failed to create manual vctime_earn transaction ${transactionId} for user ${targetUser.id}:`,
          error
        );
        // Do not fail the command if transaction logging fails
      }

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('✅ VC Time Manually Added')
        .setDescription(`Added **${minutes}** minutes of VC time to ${targetUser}`)
        .addFields(
          {
            name: '🕒 Duration',
            value: `${minutes} minutes`,
            inline: true,
          },
          {
            name: '📅 Credited Date (UTC)',
            value: dateInput,
            inline: true,
          },
          {
            name: '💰 Coins Earned',
            value: coinsEarned.toLocaleString(),
            inline: true,
          },
          {
            name: '💵 Balance Before',
            value: `${balanceBefore.toLocaleString()} coins`,
            inline: true,
          },
          {
            name: '💰 Balance After',
            value: `${balanceAfter.toLocaleString()} coins`,
            inline: true,
          },
        )
        .setFooter({ text: `Staff: ${interaction.user.username}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logger.info(
        `Staff ${interaction.user.id} manually added ${minutes} minutes (${durationMs} ms) of VC time ` +
        `to user ${targetUser.id} in guild ${guildId}, coinsEarned=${coinsEarned}, ` +
        `balance: ${balanceBefore} -> ${balanceAfter}`
      );
    } catch (error) {
      logger.error('Error in add-hours command:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ An unexpected error occurred while adding hours.',
        });
      } else {
        await interaction.reply({
          content: '❌ An unexpected error occurred while adding hours.',
          ephemeral: true,
        });
      }
    }
  },
};

