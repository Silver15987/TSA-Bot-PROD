import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { leaderboardService } from '../modules/leaderboard/services/leaderboardService';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('event-leaderboard')
    .setDescription('View event factions ranked by treasury'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const guildId = interaction.guildId!;

      const result = await leaderboardService.getEventFactionRankings(guildId);

      if (result.entries.length === 0) {
        await interaction.editReply({
          embeds: [
            createErrorEmbed(
              'No Event Factions',
              'There are no event factions on this server yet.'
            ),
          ],
        });
        return;
      }

      const topFaction = result.entries[0];
      let top3Members: { username: string; value: number; rank: number }[] = [];

      const memberResult = await leaderboardService.getFactionMemberLeaderboard(
        guildId,
        topFaction.factionId,
        'deposits'
      );
      top3Members = memberResult.entries.slice(0, 3).map((e) => ({
        username: e.username,
        value: e.value,
        rank: e.rank,
      }));

      // Spotlight: top faction + its top 3 by deposits
      let spotlight = `**#1 — ${topFaction.factionName}**\n`;
      spotlight += `💰 Treasury: **${topFaction.treasury.toLocaleString()}** coins\n`;
      if (top3Members.length > 0) {
        spotlight += `**Top 3 contributors:**\n`;
        for (const m of top3Members) {
          spotlight += `${m.rank}. ${m.username} — **${m.value.toLocaleString()}** deposited\n`;
        }
      } else {
        spotlight += `*No member deposits yet.*\n`;
      }

      // Full event faction list
      let fullList = `\n**All event factions**\n`;
      for (const entry of result.entries) {
        const medal = this.getMedal(entry.rank);
        fullList += `${medal} **${entry.rank}.** ${entry.factionName} — **${entry.treasury.toLocaleString()}** coins\n`;
      }

      const description = spotlight + fullList;

      const embed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle('Event Factions Leaderboard')
        .setDescription(description)
        .setFooter({
          text: result.fromCache
            ? 'Data cached - Updates every 15 minutes'
            : 'Fresh data calculated',
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error in event-leaderboard command:', error);
      await interaction.editReply({
        embeds: [
          createErrorEmbed(
            'Error',
            'An unexpected error occurred while fetching the event leaderboard.'
          ),
        ],
      });
    }
  },

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
