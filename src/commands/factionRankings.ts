import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { database } from '../database/client';
import { leaderboardService } from '../modules/leaderboard/services/leaderboardService';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('faction-rankings')
    .setDescription('View top factions ranked by treasury'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const guildId = interaction.guildId!;
      const userId = interaction.user.id;

      // Get faction rankings
      const result = await leaderboardService.getFactionRankings(guildId);

      if (result.entries.length === 0) {
        await interaction.editReply({
          embeds: [createErrorEmbed(
            'No Factions',
            'There are no factions on this server yet. Create one with `/faction create`!'
          )],
        });
        return;
      }

      // Get user's faction to highlight it
      const user = await database.users.findOne({ id: userId, guildId });
      const userFactionId = user?.currentFaction || null;

      // Create embed
      const embed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle('🏆 Top Factions - Treasury Rankings')
        .setDescription('Factions ranked by total treasury (asset-based)')
        .setFooter({
          text: result.fromCache
            ? 'Data cached - Updates every 15 minutes'
            : 'Fresh data calculated',
        })
        .setTimestamp();

      // Build leaderboard description
      let description = '';
      for (const entry of result.entries) {
        const medal = this.getMedal(entry.rank);
        const isUserFaction = entry.factionId === userFactionId;

        description += `${medal} **${entry.rank}.** ${entry.factionName}${isUserFaction ? ' (Your Faction)' : ''}\n`;
        description += `💰 Treasury: **${entry.treasury.toLocaleString()}** coins\n\n`;
      }

      embed.setDescription(description);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error in faction-rankings command:', error);
      await interaction.editReply({
        embeds: [createErrorEmbed(
          'Error',
          'An unexpected error occurred while fetching faction rankings.'
        )],
      });
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
};

function createErrorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(0xe74c3c);
}
