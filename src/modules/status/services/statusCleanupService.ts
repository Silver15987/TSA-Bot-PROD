import { database } from '../../../database/client';
import { statusService } from './statusService';
import logger from '../../../core/logger';

/**
 * Status Cleanup Service
 * Removes expired statuses and items from users
 */
export class StatusCleanupService {
  /**
   * Clean up expired statuses and items for all users in a guild
   * This should be run periodically (e.g., every hour)
   */
  async cleanupExpiredStatusesForGuild(guildId: string): Promise<{
    usersProcessed: number;
    statusesRemoved: number;
    itemsRemoved: number;
  }> {
    try {
      // Use a single updateMany with $pull to remove expired statuses and items
      const now = new Date();

      const result = await database.users.updateMany(
        { guildId },
        {
          $pull: {
            statuses: {
              expiresAt: { $lte: now },
            },
            items: {
              expiresAt: { $lte: now },
            },
          },
        }
      );

      const usersProcessed = result.matchedCount || 0;

      logger.info(
        `Cleanup completed for guild ${guildId}: ${usersProcessed} users matched for expired statuses/items`
      );

      // Exact removed counts are not available from updateMany without a prior scan;
      // they were informational only, so we return 0 here to keep the shape.
      return {
        usersProcessed,
        statusesRemoved: 0,
        itemsRemoved: 0,
      };
    } catch (error) {
      logger.error(`Error cleaning up expired statuses for guild ${guildId}:`, error);
      return {
        usersProcessed: 0,
        statusesRemoved: 0,
        itemsRemoved: 0,
      };
    }
  }

  /**
   * Clean up expired statuses and items for a specific user
   */
  async cleanupExpiredStatusesForUser(userId: string, guildId: string): Promise<void> {
    try {
      await statusService.cleanupExpiredStatuses(userId, guildId);
      await statusService.cleanupExpiredItems(userId, guildId);
    } catch (error) {
      logger.error(`Error cleaning up expired statuses for user ${userId}:`, error);
    }
  }
}

export const statusCleanupService = new StatusCleanupService();











