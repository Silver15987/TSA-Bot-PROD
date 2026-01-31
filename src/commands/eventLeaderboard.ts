import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { leaderboardService } from '../modules/leaderboard/services/leaderboardService';
import logger from '../core/logger';
import { formatHoursMinutes } from '../utils/timeFormatters';

export default {
  data: new SlashCommandBuilder()
    .setName('event-leaderboard')
    .setDescription('View event factions ranked by VC hours')
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!interaction.guildId || !interaction.inGuild()) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      const guildId = interaction.guildId;

      let result = await leaderboardService.getEventFactionRankings(guildId);

      // If empty, invalidate cache and retry once (handles stale empty cache)
      if (result.entries.length === 0) {
        await leaderboardService.invalidateEventFactionRankings(guildId);
        result = await leaderboardService.getEventFactionRankings(guildId);
      }

      if (result.entries.length === 0) {
        logger.warn(
          `Event leaderboard: no event factions for guildId=${guildId} (server: ${interaction.guild?.name ?? 'unknown'})`
        );
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
        'vctime'
      );
      top3Members = memberResult.entries.slice(0, 3).map((e) => ({
        username: e.username,
        value: e.value,
        rank: e.rank,
      }));

      // Spotlight: top faction + its top 3 by VC time
      let spotlight = `**#1 — ${topFaction.factionName}**\n`;
      spotlight += `⏱️ VC time: **${formatHoursMinutes(topFaction.vcTimeMs)}**\n`;
      if (top3Members.length > 0) {
        spotlight += `**Top 3 by VC time:**\n`;
        for (const m of top3Members) {
          spotlight += `${m.rank}. ${m.username} — **${formatHoursMinutes(m.value)}**\n`;
        }
      } else {
        spotlight += `*No member VC time yet.*\n`;
      }

      // Full event faction list
      let fullList = `\n**All event factions**\n`;
      for (const entry of result.entries) {
        const medal = this.getMedal(entry.rank);
        fullList += `${medal} **${entry.rank}.** ${entry.factionName} — **${formatHoursMinutes(entry.vcTimeMs)}**\n`;
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
