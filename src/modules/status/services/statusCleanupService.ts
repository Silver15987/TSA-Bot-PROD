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
      let usersProcessed = 0;
      let statusesRemoved = 0;
      let itemsRemoved = 0;

      // Get all users in the guild
      const users = await database.users.find({ guildId }).toArray();

      for (const user of users) {
        const beforeStatuses = user.statuses?.length || 0;
        const beforeItems = user.items?.length || 0;

        // Clean up expired statuses
        await statusService.cleanupExpiredStatuses(user.id, guildId);

        // Clean up expired items
        await statusService.cleanupExpiredItems(user.id, guildId);

        // Get updated counts
        const updatedUser = await database.users.findOne({ id: user.id, guildId });
        if (updatedUser) {
          const afterStatuses = updatedUser.statuses?.length || 0;
          const afterItems = updatedUser.items?.length || 0;

          statusesRemoved += beforeStatuses - afterStatuses;
          itemsRemoved += beforeItems - afterItems;
        }

        usersProcessed++;
      }

      logger.info(
        `Cleanup completed for guild ${guildId}: ` +
        `${usersProcessed} users processed, ` +
        `${statusesRemoved} statuses removed, ` +
        `${itemsRemoved} items removed`
      );

      return {
        usersProcessed,
        statusesRemoved,
        itemsRemoved,
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

