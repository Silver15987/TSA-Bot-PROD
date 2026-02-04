import { Client, EmbedBuilder, TextChannel, NewsChannel, VoiceChannel } from 'discord.js';
import { configManager } from '../../../core/configManager';
import logger from '../../../core/logger';
import { TournamentDocument, TournamentMatchDocument } from '../../../types/database';

/**
 * Tournament Announcement Service
 * Handles round result announcements and bracket image posting.
 */
class TournamentAnnouncementService {
  /**
   * Send round results and upcoming round pairings to the announcement channel.
   */
  async sendRoundResults(
    client: Client,
    tournament: TournamentDocument,
    matches: TournamentMatchDocument[]
  ): Promise<void> {
    const guildId = tournament.guildId;

    const channelId = this.getAnnouncementChannelId(guildId);
    if (!channelId) {
      logger.debug('No tournament announcement channel configured');
      return;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (
      !channel ||
      !(channel instanceof TextChannel || channel instanceof NewsChannel || channel instanceof VoiceChannel)
    ) {
      logger.warn(
        `Tournament announcement channel ${channelId} not found or not a text/announcement channel`
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Tournament Round ${tournament.currentRound} Results`)
      .setColor(0x3498db)
      .setTimestamp();

    if (matches.length === 0) {
      embed.setDescription('No matches were played this round.');
    } else {
      const lines: string[] = [];
      for (const m of matches) {
        if (m.status === 'bye' && m.winnerFactionId) {
          lines.push(`**${m.winnerFactionId}** received a bye.`);
          continue;
        }
        if (!m.winnerFactionId || !m.loserFactionId) {
          continue;
        }
        const score = m.winnerScore !== null && m.loserScore !== null
          ? `${m.winnerScore}–${m.loserScore}`
          : 'win';
        lines.push(
          `**${m.winnerFactionId}** (${score}) defeated **${m.loserFactionId}**`
        );
      }

      embed.setDescription(
        lines.length > 0 ? lines.join('\n') : 'Results are not available yet.'
      );
    }

    await channel.send({ embeds: [embed] });
  }

  /**
   * Get announcement channel ID from config:
   * tournaments.announcementChannelId, then factions.announcementChannelId.
   */
  private getAnnouncementChannelId(guildId: string): string | null {
    try {
      const config = configManager.getConfig(guildId);
      if (config.tournaments?.announcementChannelId) {
        return config.tournaments.announcementChannelId;
      }
      return config.factions?.announcementChannelId || null;
    } catch (error) {
      logger.error('Error getting tournament announcement channel ID:', error);
      return null;
    }
  }
}

export const tournamentAnnouncementService = new TournamentAnnouncementService();

