import { database } from '../../../database/client';
import logger from '../../../core/logger';

/**
 * Member History Manager
 * Handles tracking of faction member history for analytics and historical data
 */
export class MemberHistoryManager {
  /**
   * Add a member to faction history when they join
   */
  async addMemberToHistory(
    factionId: string,
    guildId: string,
    userId: string,
    username: string
  ): Promise<void> {
    try {
      const now = new Date();

      // Add member to history array
      await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $push: {
            memberHistory: {
              userId,
              username,
              joinedAt: now,
              leftAt: null,
              totalVcTimeWhileMember: 0,
              totalMessagesWhileMember: 0,
            },
          },
          $inc: {
            totalMembersEver: 1,
          },
          $set: {
            updatedAt: now,
          },
        }
      );

      // Update peak member count if current count is higher
      const faction = await database.factions.findOne({ id: factionId, guildId });
      if (faction && faction.members.length > faction.peakMemberCount) {
        await database.factions.updateOne(
          { id: factionId, guildId },
          {
            $set: {
              peakMemberCount: faction.members.length,
            },
          }
        );
      }

      logger.debug(`Added ${username} to ${factionId} member history`);
    } catch (error) {
      logger.error('Error adding member to history:', error);
    }
  }

  /**
   * Update member history when they leave (kick, leave, or disband)
   */
  async finalizeMemberHistory(
    factionId: string,
    guildId: string,
    userId: string
  ): Promise<void> {
    try {
      const now = new Date();

      // Update the member's history entry with leftAt timestamp
      await database.factions.updateOne(
        {
          id: factionId,
          guildId,
          'memberHistory.userId': userId,
          'memberHistory.leftAt': null,
        },
        {
          $set: {
            'memberHistory.$.leftAt': now,
            updatedAt: now,
          },
        }
      );

      logger.debug(`Finalized member history for user ${userId} in faction ${factionId}`);
    } catch (error) {
      logger.error('Error finalizing member history:', error);
    }
  }

  /**
   * Update VC time for a member in their history
   */
  async updateMemberVcTime(
    factionId: string,
    guildId: string,
    userId: string,
    vcTimeToAdd: number
  ): Promise<void> {
    try {
      // Update the member's VC time in their history entry
      await database.factions.updateOne(
        {
          id: factionId,
          guildId,
          'memberHistory.userId': userId,
          'memberHistory.leftAt': null,
        },
        {
          $inc: {
            'memberHistory.$.totalVcTimeWhileMember': vcTimeToAdd,
          },
          $set: {
            updatedAt: new Date(),
          },
        }
      );

      logger.debug(`Updated VC time for user ${userId} in faction ${factionId} history (+${vcTimeToAdd}ms)`);
    } catch (error) {
      logger.error('Error updating member VC time in history:', error);
    }
  }

  /**
   * Update message count for a member in their history
   */
  async updateMemberMessages(
    factionId: string,
    guildId: string,
    userId: string,
    messageCount: number = 1
  ): Promise<void> {
    try {
      // Update the member's message count in their history entry
      await database.factions.updateOne(
        {
          id: factionId,
          guildId,
          'memberHistory.userId': userId,
          'memberHistory.leftAt': null,
        },
        {
          $inc: {
            'memberHistory.$.totalMessagesWhileMember': messageCount,
          },
          $set: {
            updatedAt: new Date(),
          },
        }
      );

      logger.debug(`Updated message count for user ${userId} in faction ${factionId} history (+${messageCount})`);
    } catch (error) {
      logger.error('Error updating member messages in history:', error);
    }
  }

  /**
   * Get member's history entry from a faction
   */
  async getMemberHistory(
    factionId: string,
    guildId: string,
    userId: string
  ): Promise<any | null> {
    try {
      const faction = await database.factions.findOne({
        id: factionId,
        guildId,
        'memberHistory.userId': userId,
      });

      if (!faction) return null;

      // Find the specific member entry
      const memberEntry = faction.memberHistory.find((entry: any) => entry.userId === userId);
      return memberEntry || null;
    } catch (error) {
      logger.error('Error getting member history:', error);
      return null;
    }
  }
}

export const memberHistoryManager = new MemberHistoryManager();
