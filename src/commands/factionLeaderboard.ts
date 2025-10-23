import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { database } from '../database/client';
import { leaderboardService } from '../modules/leaderboard/services/leaderboardService';
import { FactionMemberLeaderboardType } from '../modules/leaderboard/types';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('faction-leaderboard')
    .setDescription('View your faction\'s internal leaderboard')
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Type of leaderboard to view')
        .setRequired(true)
        .addChoices(
          { name: 'Top Contributors (Deposits)', value: 'deposits' },
          { name: 'Top VC Time', value: 'vctime' }
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const userId = interaction.user.id;
      const guildId = interaction.guildId!;
      const type = interaction.options.getString('type', true) as FactionMemberLeaderboardType;

      // Check if user is in a faction
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user || !user.currentFaction) {
        await interaction.editReply({
          embeds: [createErrorEmbed(
            'Not in Faction',
            'You must be in a faction to view faction leaderboards. Use `/faction create` or get invited to join one.'
          )],
        });
        return;
      }

      // Get faction info
      const faction = await database.factions.findOne({
        id: user.currentFaction,
        guildId,
      });

      if (!faction) {
        await interaction.editReply({
          embeds: [createErrorEmbed(
            'Faction Not Found',
            'Your faction could not be found. Please contact an administrator.'
          )],
        });
        return;
      }

      // Get leaderboard data
      const result = await leaderboardService.getFactionMemberLeaderboard(
        guildId,
        user.currentFaction,
        type
      );

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
        .setColor(0x9b59b6)
        .setTitle(`${faction.name} - ${this.getLeaderboardTitle(type)}`)
        .setFooter({
          text: result.fromCache
            ? 'Data cached - Updates every 15 minutes'
            : 'Fresh data calculated',
        })
        .setTimestamp();

      // Build leaderboard description
      let description = '';
      for (const entry of result.entries) {
        const isCurrentUser = entry.userId === userId;

        if (entry.rank === 1) {
          // Special highlight for #1 position
          const formattedValue = this.formatValueInline(type, entry.value);
          description += `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n`;
          description += `┃ 👑 **MVP**               ┃\n`;
          description += `┃ <@${entry.userId}>${isCurrentUser ? ' (You)' : ''}\n`;
          description += `┃ ${formattedValue}\n`;
          description += `┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n`;
        } else {
          // Compact single-line format for other positions
          const medal = this.getMedal(entry.rank);
          const formattedValue = this.formatValueInline(type, entry.value);
          const rankSuffix = this.getRankSuffix(entry.rank);
          description += `${medal} **${entry.rank}${rankSuffix}** • <@${entry.userId}>${isCurrentUser ? ' (You)' : ''} • ${formattedValue}\n`;
        }
      }

      embed.setDescription(description);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error in faction-leaderboard command:', error);
      await interaction.editReply({
        embeds: [createErrorEmbed(
          'Error',
          'An unexpected error occurred while fetching the faction leaderboard.'
        )],
      });
    }
  },

  /**
   * Get leaderboard title based on type
   */
  getLeaderboardTitle(type: FactionMemberLeaderboardType): string {
    switch (type) {
      case 'deposits':
        return '💰 Top Contributors';
      case 'vctime':
        return '🎤 Top Voice Chat Members';
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
  formatValue(type: FactionMemberLeaderboardType, value: number): string {
    switch (type) {
      case 'deposits':
        return `💎 ${value.toLocaleString()} coins deposited`;
      case 'vctime':
        return `⏱️ ${this.formatTime(value)}`;
      default:
        return value.toLocaleString();
    }
  },

  /**
   * Format value inline (more compact for single-line display)
   */
  formatValueInline(type: FactionMemberLeaderboardType, value: number): string {
    switch (type) {
      case 'deposits':
        return `💎 **${value.toLocaleString()}** coins`;
      case 'vctime':
        return `⏱️ **${this.formatTime(value)}**`;
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
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  },
};

function createErrorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(0xe74c3c);
}
