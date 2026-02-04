import { Client, EmbedBuilder, TextChannel, NewsChannel } from 'discord.js';
import { configManager } from '../../../core/configManager';
import logger from '../../../core/logger';
import { TournamentDocument, TournamentMatchDocument } from '../../../types/database';
import { factionManager } from '../../factions/services/factionManager';

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
    if (!channel || !channel.isTextBased()) {
      logger.warn(
        `Tournament announcement channel ${channelId} not found or not a text-capable channel`
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Tournament Round ${tournament.currentRound} Results`)
      .setColor(0x3498db)
      .setTimestamp();

    // Resolve faction names for nicer output
    const factions = await factionManager.getAllFactions(guildId);
    const factionNameMap = new Map<string, string>();
    for (const f of factions) {
      factionNameMap.set(f.id, f.name);
    }

    const resolveName = (factionId: string | null): string => {
      if (!factionId) return 'Unknown';
      return factionNameMap.get(factionId) ?? factionId;
    };

    if (matches.length === 0) {
      embed.setDescription('No matches were played this round.');
    } else {
      const lines: string[] = [];
      for (const m of matches) {
        if (m.status === 'bye' && m.winnerFactionId) {
          const winnerName = resolveName(m.winnerFactionId);
          lines.push(`**${winnerName}** received a bye.`);
          continue;
        }
        if (!m.winnerFactionId || !m.loserFactionId) {
          continue;
        }
        const score = m.winnerScore !== null && m.loserScore !== null
          ? `${m.winnerScore}–${m.loserScore}`
          : 'win';
        const winnerName = resolveName(m.winnerFactionId);
        const loserName = resolveName(m.loserFactionId);
        lines.push(
          `**${winnerName}** (${score}) defeated **${loserName}**`
        );
      }

      const descriptionText = lines.length > 0 ? lines.join('\n') : 'Results are not available yet.';
      
      // Discord embed description limit is 4096 characters
      const MAX_DESCRIPTION_LENGTH = 4096;
      let finalDescription = descriptionText;
      if (descriptionText.length > MAX_DESCRIPTION_LENGTH) {
        finalDescription = descriptionText.substring(0, MAX_DESCRIPTION_LENGTH - 20) + '... (truncated)';
        logger.warn(
          `Tournament round results description exceeded ${MAX_DESCRIPTION_LENGTH} characters and was truncated`
        );
      }
      
      embed.setDescription(finalDescription);
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

