import { database } from '../../../database/client';
import { StatusEntry, ItemEntry } from '../../../types/database';
import { multiplierCacheService } from './multiplierCacheService';
import logger from '../../../core/logger';

/**
 * Status Service
 * Manages user statuses, buffs, debuffs, and items affecting multipliers
 */
export class StatusService {
  /**
   * Add a status to a user
   */
  async addStatus(
    userId: string,
    guildId: string,
    status: Omit<StatusEntry, 'id'>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const statusId = this.generateStatusId();
      const statusEntry: StatusEntry = {
        ...status,
        id: statusId,
      };

      // Update user document
      const result = await database.users.updateOne(
        { id: userId, guildId },
        {
          $push: { statuses: statusEntry },
          $set: { updatedAt: new Date() },
        }
      );

      if (result.modifiedCount === 0) {
        // User might not exist, create minimal user document
        const user = await database.users.findOne({ id: userId, guildId });
        if (!user) {
          return {
            success: false,
            error: 'User not found',
          };
        }
      }

      // Invalidate caches
      await multiplierCacheService.invalidateAllUserStatusCaches(userId, guildId);

      logger.info(`Added status ${statusEntry.name} to user ${userId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error adding status to user ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Remove a status from a user
   */
  async removeStatus(
    userId: string,
    guildId: string,
    statusId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await database.users.updateOne(
        { id: userId, guildId },
        {
          $pull: { statuses: { id: statusId } },
          $set: { updatedAt: new Date() },
        }
      );

      if (result.modifiedCount === 0) {
        return {
          success: false,
          error: 'Status not found or user not found',
        };
      }

      // Invalidate caches
      await multiplierCacheService.invalidateAllUserStatusCaches(userId, guildId);

      logger.info(`Removed status ${statusId} from user ${userId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error removing status from user ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get all active statuses for a user (with Redis caching)
   */
  async getUserStatuses(userId: string, guildId: string): Promise<StatusEntry[]> {
    try {
      // Try Redis cache first
      const cached = await multiplierCacheService.getUserStatusesFromCache(userId, guildId);
      if (cached !== null) {
        return cached;
      }

      // Cache miss - query database
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user || !user.statuses) {
        // Cache empty result
        await multiplierCacheService.setUserStatusesCache(userId, guildId, []);
        return [];
      }

      // Filter out expired statuses
      const now = new Date();
      const activeStatuses = user.statuses.filter(
        (status) => !status.expiresAt || new Date(status.expiresAt) > now
      );

      // If some statuses expired, clean them up
      if (activeStatuses.length !== user.statuses.length) {
        await this.cleanupExpiredStatuses(userId, guildId);
      }

      // Cache the result
      await multiplierCacheService.setUserStatusesCache(userId, guildId, activeStatuses);

      return activeStatuses;
    } catch (error) {
      logger.error(`Error getting user statuses for ${userId}:`, error);
      return [];
    }
  }

  /**
   * Add an item to a user
   */
  async addItem(
    userId: string,
    guildId: string,
    item: Omit<ItemEntry, 'id'>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const itemId = this.generateStatusId();
      const itemEntry: ItemEntry = {
        ...item,
        id: itemId,
      };

      // Update user document
      const result = await database.users.updateOne(
        { id: userId, guildId },
        {
          $push: { items: itemEntry },
          $set: { updatedAt: new Date() },
        }
      );

      if (result.modifiedCount === 0) {
        const user = await database.users.findOne({ id: userId, guildId });
        if (!user) {
          return {
            success: false,
            error: 'User not found',
          };
        }
      }

      // Invalidate caches
      await multiplierCacheService.invalidateAllUserStatusCaches(userId, guildId);

      logger.info(`Added item ${itemEntry.itemId} to user ${userId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error adding item to user ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Remove an item from a user
   */
  async removeItem(
    userId: string,
    guildId: string,
    itemId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await database.users.updateOne(
        { id: userId, guildId },
        {
          $pull: { items: { id: itemId } },
          $set: { updatedAt: new Date() },
        }
      );

      if (result.modifiedCount === 0) {
        return {
          success: false,
          error: 'Item not found or user not found',
        };
      }

      // Invalidate caches
      await multiplierCacheService.invalidateAllUserStatusCaches(userId, guildId);

      logger.info(`Removed item ${itemId} from user ${userId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error removing item from user ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get all active items for a user (with Redis caching)
   */
  async getUserItems(userId: string, guildId: string): Promise<ItemEntry[]> {
    try {
      // Try Redis cache first
      const cached = await multiplierCacheService.getUserItemsFromCache(userId, guildId);
      if (cached !== null) {
        return cached;
      }

      // Cache miss - query database
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user || !user.items) {
        // Cache empty result
        await multiplierCacheService.setUserItemsCache(userId, guildId, []);
        return [];
      }

      // Filter out expired items
      const now = new Date();
      const activeItems = user.items.filter(
        (item) => !item.expiresAt || new Date(item.expiresAt) > now
      );

      // If some items expired, clean them up
      if (activeItems.length !== user.items.length) {
        await this.cleanupExpiredItems(userId, guildId);
      }

      // Cache the result
      await multiplierCacheService.setUserItemsCache(userId, guildId, activeItems);

      return activeItems;
    } catch (error) {
      logger.error(`Error getting user items for ${userId}:`, error);
      return [];
    }
  }

  /**
   * Clean up expired statuses for a user
   */
  async cleanupExpiredStatuses(userId: string, guildId: string): Promise<void> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user || !user.statuses) {
        return;
      }

      const now = new Date();
      const activeStatuses = user.statuses.filter(
        (status) => !status.expiresAt || new Date(status.expiresAt) > now
      );

      if (activeStatuses.length !== user.statuses.length) {
        await database.users.updateOne(
          { id: userId, guildId },
          {
            $set: {
              statuses: activeStatuses,
              updatedAt: new Date(),
            },
          }
        );

        // Invalidate caches
        await multiplierCacheService.invalidateAllUserStatusCaches(userId, guildId);

        logger.debug(`Cleaned up ${user.statuses.length - activeStatuses.length} expired statuses for user ${userId}`);
      }
    } catch (error) {
      logger.error(`Error cleaning up expired statuses for user ${userId}:`, error);
    }
  }

  /**
   * Clean up expired items for a user
   */
  async cleanupExpiredItems(userId: string, guildId: string): Promise<void> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user || !user.items) {
        return;
      }

      const now = new Date();
      const activeItems = user.items.filter(
        (item) => !item.expiresAt || new Date(item.expiresAt) > now
      );

      if (activeItems.length !== user.items.length) {
        await database.users.updateOne(
          { id: userId, guildId },
          {
            $set: {
              items: activeItems,
              updatedAt: new Date(),
            },
          }
        );

        // Invalidate caches
        await multiplierCacheService.invalidateAllUserStatusCaches(userId, guildId);

        logger.debug(`Cleaned up ${user.items.length - activeItems.length} expired items for user ${userId}`);
      }
    } catch (error) {
      logger.error(`Error cleaning up expired items for user ${userId}:`, error);
    }
  }

  /**
   * Set multiplier enabled/disabled for a user (admin toggle)
   */
  async setMultiplierEnabled(
    userId: string,
    guildId: string,
    enabled: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await database.users.updateOne(
        { id: userId, guildId },
        {
          $set: {
            multiplierEnabled: enabled,
            updatedAt: new Date(),
          },
        }
      );

      if (result.modifiedCount === 0) {
        return {
          success: false,
          error: 'User not found',
        };
      }

      // Invalidate caches
      await multiplierCacheService.invalidateAllUserMultiplierCaches(userId, guildId);

      logger.info(`Set multiplier enabled to ${enabled} for user ${userId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error setting multiplier enabled for user ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate unique status/item ID
   */
  private generateStatusId(): string {
    return `status_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

export const statusService = new StatusService();

