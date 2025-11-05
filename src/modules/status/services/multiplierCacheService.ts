import { redis, RedisKeys } from '../../../cache/client';
import logger from '../../../core/logger';

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
}

export const multiplierCacheService = new MultiplierCacheService();

