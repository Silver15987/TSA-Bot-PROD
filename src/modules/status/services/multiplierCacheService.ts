import { redis, RedisKeys } from '../../../cache/client';
import logger from '../../../core/logger';
import { StatusEntry, ItemEntry } from '../../../types/database';

/**
 * Multiplier Cache Service
 * Handles Redis caching for multiplier values with graceful fallback
 */
export class MultiplierCacheService {
  /**
   * Get cached user multiplier from Redis
   */
  async getUserMultiplierFromCache(userId: string, guildId: string): Promise<number | null> {
    try {
      if (!redis.isReady()) {
        logger.debug(`Redis not ready, skipping cache read for user ${userId}`);
        return null;
      }

      const key = RedisKeys.userMultiplier(userId, guildId);
      const cached = await redis.get(key);
      
      if (cached) {
        const multiplier = parseFloat(cached);
        if (!isNaN(multiplier)) {
          return multiplier;
        }
      }
      
      return null;
    } catch (error) {
      logger.warn(`Failed to get user multiplier from cache for ${userId}:`, error);
      return null;
    }
  }

  /**
   * Get cached faction multiplier from Redis
   */
  async getFactionMultiplierFromCache(factionId: string, guildId: string): Promise<number | null> {
    try {
      if (!redis.isReady()) {
        logger.debug(`Redis not ready, skipping cache read for faction ${factionId}`);
        return null;
      }

      const key = RedisKeys.factionMultiplier(factionId, guildId);
      const cached = await redis.get(key);
      
      if (cached) {
        const multiplier = parseFloat(cached);
        if (!isNaN(multiplier)) {
          return multiplier;
        }
      }
      
      return null;
    } catch (error) {
      logger.warn(`Failed to get faction multiplier from cache for ${factionId}:`, error);
      return null;
    }
  }

  /**
   * Get cached total multiplier from Redis
   */
  async getTotalMultiplierFromCache(userId: string, guildId: string): Promise<number | null> {
    try {
      if (!redis.isReady()) {
        logger.debug(`Redis not ready, skipping cache read for total multiplier ${userId}`);
        return null;
      }

      const key = RedisKeys.totalMultiplier(userId, guildId);
      const cached = await redis.get(key);
      
      if (cached) {
        const multiplier = parseFloat(cached);
        if (!isNaN(multiplier)) {
          return multiplier;
        }
      }
      
      return null;
    } catch (error) {
      logger.warn(`Failed to get total multiplier from cache for ${userId}:`, error);
      return null;
    }
  }

  /**
   * Set user multiplier cache (no expiration - persistent until invalidated)
   */
  async setUserMultiplierCache(userId: string, guildId: string, multiplier: number): Promise<void> {
    try {
      if (!redis.isReady()) {
        logger.debug(`Redis not ready, skipping cache write for user ${userId}`);
        return;
      }

      const key = RedisKeys.userMultiplier(userId, guildId);
      await redis.set(key, multiplier.toString());
      logger.debug(`Cached user multiplier for ${userId}: ${multiplier}`);
    } catch (error) {
      logger.warn(`Failed to cache user multiplier for ${userId}:`, error);
      // Don't throw - caching is not critical
    }
  }

  /**
   * Set faction multiplier cache (no expiration - persistent until invalidated)
   */
  async setFactionMultiplierCache(factionId: string, guildId: string, multiplier: number): Promise<void> {
    try {
      if (!redis.isReady()) {
        logger.debug(`Redis not ready, skipping cache write for faction ${factionId}`);
        return;
      }

      const key = RedisKeys.factionMultiplier(factionId, guildId);
      await redis.set(key, multiplier.toString());
      logger.debug(`Cached faction multiplier for ${factionId}: ${multiplier}`);
    } catch (error) {
      logger.warn(`Failed to cache faction multiplier for ${factionId}:`, error);
      // Don't throw - caching is not critical
    }
  }

  /**
   * Set total multiplier cache (5 minutes TTL)
   */
  async setTotalMultiplierCache(userId: string, guildId: string, multiplier: number): Promise<void> {
    try {
      if (!redis.isReady()) {
        logger.debug(`Redis not ready, skipping cache write for total multiplier ${userId}`);
        return;
      }

      const key = RedisKeys.totalMultiplier(userId, guildId);
      const TTL = 300; // 5 minutes
      await redis.setex(key, TTL, multiplier.toString());
      logger.debug(`Cached total multiplier for ${userId}: ${multiplier} (TTL: ${TTL}s)`);
    } catch (error) {
      logger.warn(`Failed to cache total multiplier for ${userId}:`, error);
      // Don't throw - caching is not critical
    }
  }

  /**
   * Invalidate user multiplier cache
   */
  async invalidateUserMultiplierCache(userId: string, guildId: string): Promise<void> {
    try {
      if (!redis.isReady()) {
        return;
      }

      const key = RedisKeys.userMultiplier(userId, guildId);
      await redis.del(key);
      logger.debug(`Invalidated user multiplier cache for ${userId}`);
    } catch (error) {
      logger.warn(`Failed to invalidate user multiplier cache for ${userId}:`, error);
    }
  }

  /**
   * Invalidate faction multiplier cache
   */
  async invalidateFactionMultiplierCache(factionId: string, guildId: string): Promise<void> {
    try {
      if (!redis.isReady()) {
        return;
      }

      const key = RedisKeys.factionMultiplier(factionId, guildId);
      await redis.del(key);
      logger.debug(`Invalidated faction multiplier cache for ${factionId}`);
    } catch (error) {
      logger.warn(`Failed to invalidate faction multiplier cache for ${factionId}:`, error);
    }
  }

  /**
   * Invalidate total multiplier cache
   */
  async invalidateTotalMultiplierCache(userId: string, guildId: string): Promise<void> {
    try {
      if (!redis.isReady()) {
        return;
      }

      const key = RedisKeys.totalMultiplier(userId, guildId);
      await redis.del(key);
      logger.debug(`Invalidated total multiplier cache for ${userId}`);
    } catch (error) {
      logger.warn(`Failed to invalidate total multiplier cache for ${userId}:`, error);
    }
  }

  /**
   * Invalidate all multiplier caches for a user (user + total)
   */
  async invalidateAllUserMultiplierCaches(userId: string, guildId: string): Promise<void> {
    await Promise.all([
      this.invalidateUserMultiplierCache(userId, guildId),
      this.invalidateTotalMultiplierCache(userId, guildId),
    ]);
  }

  /**
   * Get cached user statuses from Redis
   */
  async getUserStatusesFromCache(userId: string, guildId: string): Promise<StatusEntry[] | null> {
    try {
      if (!redis.isReady()) {
        logger.debug(`Redis not ready, skipping status cache read for user ${userId}`);
        return null;
      }

      const key = RedisKeys.userStatuses(userId, guildId);
      const cached = await redis.get(key);
      
      if (cached) {
        try {
          const statuses = JSON.parse(cached) as StatusEntry[];
          // Filter out expired statuses
          const now = new Date();
          const activeStatuses = statuses.filter(
            (status) => !status.expiresAt || new Date(status.expiresAt) > now
          );
          return activeStatuses;
        } catch (parseError) {
          logger.warn(`Failed to parse cached statuses for ${userId}:`, parseError);
          return null;
        }
      }
      
      return null;
    } catch (error) {
      logger.warn(`Failed to get user statuses from cache for ${userId}:`, error);
      return null;
    }
  }

  /**
   * Set user statuses cache with TTL
   */
  async setUserStatusesCache(
    userId: string,
    guildId: string,
    statuses: StatusEntry[],
    ttlSeconds?: number
  ): Promise<void> {
    try {
      if (!redis.isReady()) {
        logger.debug(`Redis not ready, skipping status cache write for user ${userId}`);
        return;
      }

      const key = RedisKeys.userStatuses(userId, guildId);
      const jsonData = JSON.stringify(statuses);

      // Calculate TTL: use earliest expiration if available, otherwise default 1 hour
      let ttl = ttlSeconds || 3600; // Default 1 hour
      if (!ttlSeconds && statuses.length > 0) {
        const now = Date.now();
        const expirations = statuses
          .map(s => s.expiresAt ? new Date(s.expiresAt).getTime() - now : Infinity)
          .filter(t => t > 0 && t < Infinity);
        
        if (expirations.length > 0) {
          const earliestExpiration = Math.min(...expirations);
          ttl = Math.max(60, Math.floor(earliestExpiration / 1000)); // At least 1 minute
        }
      }

      await redis.setex(key, ttl, jsonData);
      logger.debug(`Cached user statuses for ${userId}: ${statuses.length} statuses (TTL: ${ttl}s)`);
    } catch (error) {
      logger.warn(`Failed to cache user statuses for ${userId}:`, error);
      // Don't throw - caching is not critical
    }
  }

  /**
   * Get cached user items from Redis
   */
  async getUserItemsFromCache(userId: string, guildId: string): Promise<ItemEntry[] | null> {
    try {
      if (!redis.isReady()) {
        logger.debug(`Redis not ready, skipping items cache read for user ${userId}`);
        return null;
      }

      const key = RedisKeys.userItems(userId, guildId);
      const cached = await redis.get(key);
      
      if (cached) {
        try {
          const items = JSON.parse(cached) as ItemEntry[];
          // Filter out expired items
          const now = new Date();
          const activeItems = items.filter(
            (item) => !item.expiresAt || new Date(item.expiresAt) > now
          );
          return activeItems;
        } catch (parseError) {
          logger.warn(`Failed to parse cached items for ${userId}:`, parseError);
          return null;
        }
      }
      
      return null;
    } catch (error) {
      logger.warn(`Failed to get user items from cache for ${userId}:`, error);
      return null;
    }
  }

  /**
   * Set user items cache with TTL
   */
  async setUserItemsCache(
    userId: string,
    guildId: string,
    items: ItemEntry[],
    ttlSeconds?: number
  ): Promise<void> {
    try {
      if (!redis.isReady()) {
        logger.debug(`Redis not ready, skipping items cache write for user ${userId}`);
        return;
      }

      const key = RedisKeys.userItems(userId, guildId);
      const jsonData = JSON.stringify(items);

      // Calculate TTL: use earliest expiration if available, otherwise default 1 hour
      let ttl = ttlSeconds || 3600; // Default 1 hour
      if (!ttlSeconds && items.length > 0) {
        const now = Date.now();
        const expirations = items
          .map(i => i.expiresAt ? new Date(i.expiresAt).getTime() - now : Infinity)
          .filter(t => t > 0 && t < Infinity);
        
        if (expirations.length > 0) {
          const earliestExpiration = Math.min(...expirations);
          ttl = Math.max(60, Math.floor(earliestExpiration / 1000)); // At least 1 minute
        }
      }

      await redis.setex(key, ttl, jsonData);
      logger.debug(`Cached user items for ${userId}: ${items.length} items (TTL: ${ttl}s)`);
    } catch (error) {
      logger.warn(`Failed to cache user items for ${userId}:`, error);
      // Don't throw - caching is not critical
    }
  }

  /**
   * Invalidate user statuses cache
   */
  async invalidateUserStatusesCache(userId: string, guildId: string): Promise<void> {
    try {
      if (!redis.isReady()) {
        return;
      }

      const key = RedisKeys.userStatuses(userId, guildId);
      await redis.del(key);
      logger.debug(`Invalidated user statuses cache for ${userId}`);
    } catch (error) {
      logger.warn(`Failed to invalidate user statuses cache for ${userId}:`, error);
    }
  }

  /**
   * Invalidate user items cache
   */
  async invalidateUserItemsCache(userId: string, guildId: string): Promise<void> {
    try {
      if (!redis.isReady()) {
        return;
      }

      const key = RedisKeys.userItems(userId, guildId);
      await redis.del(key);
      logger.debug(`Invalidated user items cache for ${userId}`);
    } catch (error) {
      logger.warn(`Failed to invalidate user items cache for ${userId}:`, error);
    }
  }

  /**
   * Invalidate all status/item caches for a user
   */
  async invalidateAllUserStatusCaches(userId: string, guildId: string): Promise<void> {
    await Promise.all([
      this.invalidateUserStatusesCache(userId, guildId),
      this.invalidateUserItemsCache(userId, guildId),
      this.invalidateAllUserMultiplierCaches(userId, guildId), // Also invalidate multipliers
    ]);
  }
}

export const multiplierCacheService = new MultiplierCacheService();

