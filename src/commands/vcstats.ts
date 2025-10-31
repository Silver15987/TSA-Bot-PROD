import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { database } from '../database/client';
import { sessionManager } from '../modules/voiceTracking/services/sessionManager';
import { coinCalculator } from '../modules/voiceTracking/services/coinCalculator';
import logger from '../core/logger';
import { formatDuration } from '../utils/timeFormatters';

export default {
  data: new SlashCommandBuilder()
    .setName('vcstats')
    .setDescription('View voice channel statistics')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to check stats for (default: yourself)')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const targetUser = interaction.options.getUser('user') || interaction.user;
      const guildId = interaction.guildId!;

      const userData = await database.users.findOne({
        id: targetUser.id,
        guildId,
      });

      if (!userData) {
        await interaction.editReply({
          content: `${targetUser.id === interaction.user.id ? 'You have' : 'This user has'} no voice channel activity yet.\n` +
            `Join a voice channel in the tracked category to start earning coins!`,
        });
        return;
      }

      const activeSession = await sessionManager.getSession(targetUser.id, guildId);

      let currentSessionInfo = '';
      if (activeSession) {
        const currentDuration = Date.now() - activeSession.sessionStartTime;
        const currentCoins = coinCalculator.calculateCoins(currentDuration, guildId);

        currentSessionInfo = `\n\n**Current Session:**\n` +
          `Duration: ${formatDuration(currentDuration, { shortFormat: true })}\n` +
          `Coins Earning: ${currentCoins.toLocaleString()}`;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`Voice Channel Statistics`)
        .setDescription(`Statistics for ${targetUser.toString()}`)
        .addFields(
          {
            name: 'Total VC Time',
            value: formatDuration(userData.totalVcTime, { shortFormat: true }),
            inline: true,
          },
          {
            name: 'Daily VC Time',
            value: formatDuration(userData.dailyVcTime, { shortFormat: true }),
            inline: true,
          },
          {
            name: 'Weekly VC Time',
            value: formatDuration(userData.weeklyVcTime, { shortFormat: true }),
            inline: true,
          },
          {
            name: 'Total Coins Earned',
            value: userData.totalCoinsEarned.toLocaleString(),
            inline: true,
          },
          {
            name: 'Current Balance',
            value: userData.coins.toLocaleString(),
            inline: true,
          },
          {
            name: 'Daily Coins Earned',
            value: userData.dailyCoinsEarned.toLocaleString(),
            inline: true,
          },
          {
            name: 'Current Streak',
            value: `${userData.currentStreak} days`,
            inline: true,
          },
          {
            name: 'Longest Streak',
            value: `${userData.longestStreak} days`,
            inline: true,
          },
          {
            name: 'Last Active',
            value: formatDate(userData.lastActiveDate),
            inline: true,
          }
        )
        .setFooter({ text: currentSessionInfo || 'Not currently in a tracked voice channel' })
        .setThumbnail(targetUser.displayAvatarURL())
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error in vcstats command:', error);
      await interaction.editReply({
        content: 'An error occurred while fetching voice channel statistics. Please try again.',
      });
    }
  },
};

/**
 * Format date to relative time or absolute date
 */
function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return new Date(date).toLocaleDateString();
  }
}
