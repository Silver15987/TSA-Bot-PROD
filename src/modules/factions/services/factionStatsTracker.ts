import { database } from '../../../database/client';
import { memberHistoryManager } from './memberHistoryManager';
import logger from '../../../core/logger';

/**
 * Faction Stats Tracker
 * Handles tracking of faction-specific statistics (VC time, messages)
 */
export class FactionStatsTracker {
  /**
   * Update faction VC time and member history when user spends time in faction VC
   */
  async updateFactionVcTime(
    factionId: string,
    guildId: string,
    userId: string,
    vcTimeToAdd: number
  ): Promise<void> {
    try {
      // Update faction's total VC time
      await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $inc: {
            totalFactionVcTime: vcTimeToAdd,
            totalVcTime: vcTimeToAdd, // Also update general total
          },
          $set: {
            updatedAt: new Date(),
          },
        }
      );

      // Update user's faction VC time
      await database.users.updateOne(
        { id: userId, guildId },
        {
          $inc: {
            factionVcTime: vcTimeToAdd,
            lifetimeFactionVcTime: vcTimeToAdd,
          },
          $set: {
            updatedAt: new Date(),
          },
        }
      );

      // Update member history
      await memberHistoryManager.updateMemberVcTime(factionId, guildId, userId, vcTimeToAdd);

      logger.debug(`Updated faction VC time: ${factionId}, user: ${userId}, time: ${vcTimeToAdd}ms`);
    } catch (error) {
      logger.error('Error updating faction VC time:', error);
    }
  }

  /**
   * Update faction message count when user sends message in faction channel
   */
  async updateFactionMessages(
    factionId: string,
    guildId: string,
    userId: string,
    messageCount: number = 1
  ): Promise<void> {
    try {
      // Update faction's total messages
      await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $inc: {
            totalMessages: messageCount,
          },
          $set: {
            updatedAt: new Date(),
          },
        }
      );

      // Update member history
      await memberHistoryManager.updateMemberMessages(factionId, guildId, userId, messageCount);

      logger.debug(`Updated faction messages: ${factionId}, user: ${userId}, count: ${messageCount}`);
    } catch (error) {
      logger.error('Error updating faction messages:', error);
    }
  }

  /**
   * Get faction by channel ID
   */
  async getFactionByChannelId(channelId: string, guildId: string): Promise<string | null> {
    try {
      const faction = await database.factions.findOne({ channelId, guildId, disbanded: false });
      return faction?.id || null;
    } catch (error) {
      logger.error('Error getting faction by channel ID:', error);
      return null;
    }
  }

  /**
   * Check if a channel is a faction voice channel
   */
  async isFactionChannel(channelId: string, guildId: string): Promise<boolean> {
    try {
      const faction = await database.factions.findOne({ channelId, guildId, disbanded: false });
      return faction !== null;
    } catch (error) {
      logger.error('Error checking if channel is faction channel:', error);
      return false;
    }
  }

  /**
   * Finalize active VC session for a user leaving faction
   * This handles the edge case where user leaves faction while in VC
   */
  async finalizeActiveVcSession(
    factionId: string,
    guildId: string,
    userId: string,
    sessionStartTime: number
  ): Promise<void> {
    try {
      const now = Date.now();
      const vcTimeToAdd = now - sessionStartTime;

      if (vcTimeToAdd > 0) {
        // Add the time spent up to this point
        await this.updateFactionVcTime(factionId, guildId, userId, vcTimeToAdd);

        logger.info(`Finalized VC session for user ${userId} leaving faction ${factionId}: ${vcTimeToAdd}ms`);
      }
    } catch (error) {
      logger.error('Error finalizing active VC session:', error);
    }
  }
}

export const factionStatsTracker = new FactionStatsTracker();
