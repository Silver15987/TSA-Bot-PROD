import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { leaderboardService } from '../modules/leaderboard/services/leaderboardService';
import { PersonalLeaderboardType } from '../modules/leaderboard/types';
import logger from '../core/logger';
import { formatHoursMinutes } from '../utils/timeFormatters';

export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View server leaderboards')
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Type of leaderboard to view')
        .setRequired(true)
        .addChoices(
          { name: 'Coins', value: 'coins' },
          { name: 'VC Time', value: 'vctime' },
          { name: 'Streak', value: 'streak' }
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const guildId = interaction.guildId!;
      const type = interaction.options.getString('type', true) as PersonalLeaderboardType;

      // Get leaderboard data
      const result = await leaderboardService.getPersonalLeaderboard(guildId, type);

      if (result.entries.length === 0) {
        await interaction.editReply({
          embeds: [createErrorEmbed(
            'No Data',
            'There are no entries for this leaderboard yet.'
          )],
        });
        return;
      }

      // Create embed
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(this.getLeaderboardTitle(type))
        .setFooter({
          text: result.fromCache
            ? 'Data cached - Updates every 15 minutes'
            : 'Fresh data calculated',
        })
        .setTimestamp();

      // Build leaderboard description
      let description = '';
      for (const entry of result.entries) {
        if (entry.rank === 1) {
          // Special highlight for #1 position
          const formattedValue = this.formatValueInline(type, entry.value);
          description += `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n`;
          description += `┃ 👑 **CHAMPION**           ┃\n`;
          description += `┃ <@${entry.userId}>\n`;
          description += `┃ ${formattedValue}\n`;
          description += `┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n`;
        } else {
          // Compact single-line format for other positions
          const medal = this.getMedal(entry.rank);
          const formattedValue = this.formatValueInline(type, entry.value);
          const rankSuffix = this.getRankSuffix(entry.rank);
          description += `${medal} **${entry.rank}${rankSuffix}** • <@${entry.userId}> • ${formattedValue}\n`;
        }
      }

      embed.setDescription(description);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error in leaderboard command:', error);
      await interaction.editReply({
        embeds: [createErrorEmbed(
          'Error',
          'An unexpected error occurred while fetching the leaderboard.'
        )],
      });
    }
  },

  /**
   * Get leaderboard title based on type
   */
  getLeaderboardTitle(type: PersonalLeaderboardType): string {
    switch (type) {
      case 'coins':
        return '💰 Top Coin Holders';
      case 'vctime':
        return '📚 Top Study Hours';
      case 'streak':
        return '🔥 Top Daily Streaks';
      default:
        return '📊 Leaderboard';
    }
  },

  /**
   * Get medal emoji for rank
   */
  getMedal(rank: number): string {
    switch (rank) {
      case 1:
        return '🥇';
      case 2:
        return '🥈';
      case 3:
        return '🥉';
      default:
        return '📊';
    }
  },

  /**
   * Format value based on type (kept for backward compatibility)
   */
  formatValue(type: PersonalLeaderboardType, value: number): string {
    switch (type) {
      case 'coins':
        return `💎 ${value.toLocaleString()} coins`;
      case 'vctime':
        return `⏱️ ${this.formatTime(value)}`;
      case 'streak':
        return `🔥 ${value} day${value !== 1 ? 's' : ''}`;
      default:
        return value.toLocaleString();
    }
  },

  /**
   * Format value inline (more compact for single-line display)
   */
  formatValueInline(type: PersonalLeaderboardType, value: number): string {
    switch (type) {
      case 'coins':
        return `💎 **${value.toLocaleString()}** coins`;
      case 'vctime':
        return `⏱️ **${this.formatTime(value)}**`;
      case 'streak':
        return `🔥 **${value}** day${value !== 1 ? 's' : ''}`;
      default:
        return value.toLocaleString();
    }
  },

  /**
   * Get rank suffix (st, nd, rd, th)
   */
  getRankSuffix(rank: number): string {
    if (rank === 1) return 'st';
    if (rank === 2) return 'nd';
    if (rank === 3) return 'rd';
    return 'th';
  },

  /**
   * Format milliseconds to readable time
   */
  formatTime(ms: number): string {
    return formatHoursMinutes(ms);
  },
};

function createErrorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(0xe74c3c);
}
