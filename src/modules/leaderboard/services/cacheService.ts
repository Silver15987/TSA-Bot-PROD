import { redis } from '../../../cache/client';
import logger from '../../../core/logger';

/**
 * Cache Service for Leaderboards
 * Handles Redis caching with stampede prevention using locks
 */
export class CacheService {
  private readonly TTL = 900; // 15 minutes in seconds
  private readonly LOCK_TTL = 10; // 10 seconds for lock expiration
  private readonly LOCK_RETRY_DELAY = 100; // 100ms between retries
  private readonly MAX_LOCK_RETRIES = 50; // Max 5 seconds of waiting (50 * 100ms)

  /**
   * Get cached data or calculate if expired
   */
  async getOrCalculate<T>(
    cacheKey: string,
    calculateFn: () => Promise<T>
  ): Promise<{ data: T; fromCache: boolean }> {
    try {
      // Try to get cached data
      const cached = await this.get<T>(cacheKey);
      if (cached) {
        logger.debug(`Cache HIT for ${cacheKey}`);
        return { data: cached, fromCache: true };
      }

      logger.debug(`Cache MISS for ${cacheKey}`);

      // Try to acquire lock
      const lockAcquired = await this.acquireLock(cacheKey);
      if (lockAcquired) {
        try {
          // Double-check cache (another process might have calculated it)
          const recheck = await this.get<T>(cacheKey);
          if (recheck) {
            logger.debug(`Cache populated by another process for ${cacheKey}`);
            return { data: recheck, fromCache: true };
          }

          // Calculate fresh data
          logger.debug(`Calculating fresh data for ${cacheKey}`);
          const freshData = await calculateFn();

          // Store in cache
          await this.set(cacheKey, freshData);

          return { data: freshData, fromCache: false };
        } finally {
          // Always release lock
          await this.releaseLock(cacheKey);
        }
      } else {
        // Lock not acquired - wait and retry getting from cache
        logger.debug(`Lock not acquired for ${cacheKey}, waiting for calculation...`);
        const waitedData = await this.waitForCache<T>(cacheKey);

        if (waitedData) {
          return { data: waitedData, fromCache: true };
        }

        // If still no data after waiting, calculate anyway (fallback)
        logger.warn(`Cache stampede protection failed for ${cacheKey}, calculating anyway`);
        const freshData = await calculateFn();
        return { data: freshData, fromCache: false };
      }
    } catch (error) {
      logger.error(`Cache service error for ${cacheKey}:`, error);
      // Fallback to direct calculation on error
      const freshData = await calculateFn();
      return { data: freshData, fromCache: false };
    }
  }

  /**
   * Get data from cache
   */
  private async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redis.get(key);
      if (!data) return null;

      return JSON.parse(data) as T;
    } catch (error) {
      logger.error(`Error getting cache for ${key}:`, error);
      return null;
    }
  }

  /**
   * Set data in cache with TTL
   */
  private async set<T>(key: string, data: T): Promise<void> {
    try {
      await redis.setex(key, this.TTL, JSON.stringify(data));
      logger.debug(`Cached data for ${key} with TTL ${this.TTL}s`);
    } catch (error) {
      logger.error(`Error setting cache for ${key}:`, error);
    }
  }

  /**
   * Acquire lock for cache calculation
   */
  private async acquireLock(cacheKey: string): Promise<boolean> {
    const lockKey = `${cacheKey}:lock`;
    try {
      // SET NX (set if not exists) with expiration
      const result = await redis.getClient().set(lockKey, '1', 'EX', this.LOCK_TTL, 'NX');
      return result === 'OK';
    } catch (error) {
      logger.error(`Error acquiring lock for ${cacheKey}:`, error);
      return false;
    }
  }

  /**
   * Release lock
   */
  private async releaseLock(cacheKey: string): Promise<void> {
    const lockKey = `${cacheKey}:lock`;
    try {
      await redis.del(lockKey);
      logger.debug(`Released lock for ${cacheKey}`);
    } catch (error) {
      logger.error(`Error releasing lock for ${cacheKey}:`, error);
    }
  }

  /**
   * Wait for cache to be populated by another process
   */
  private async waitForCache<T>(cacheKey: string): Promise<T | null> {
    for (let i = 0; i < this.MAX_LOCK_RETRIES; i++) {
      // Wait a bit
      await this.sleep(this.LOCK_RETRY_DELAY);

      // Check if data is now available
      const data = await this.get<T>(cacheKey);
      if (data) {
        logger.debug(`Cache became available for ${cacheKey} after ${i + 1} retries`);
        return data;
      }
    }

    logger.warn(`Cache not available for ${cacheKey} after ${this.MAX_LOCK_RETRIES} retries`);
    return null;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Invalidate cache for a specific key
   */
  async invalidate(cacheKey: string): Promise<void> {
    try {
      await redis.del(cacheKey);
      logger.debug(`Invalidated cache for ${cacheKey}`);
    } catch (error) {
      logger.error(`Error invalidating cache for ${cacheKey}:`, error);
    }
  }

  /**
   * Build cache key for personal leaderboard
   */
  buildPersonalLeaderboardKey(guildId: string, type: string): string {
    return `leaderboard:${guildId}:personal:${type}`;
  }

  /**
   * Build cache key for faction member leaderboard
   */
  buildFactionMemberKey(guildId: string, factionId: string, type: string): string {
    return `leaderboard:${guildId}:faction_member:${factionId}:${type}`;
  }

  /**
   * Build cache key for faction rankings
   */
  buildFactionRankingsKey(guildId: string): string {
    return `leaderboard:${guildId}:faction_rankings:treasury`;
  }
}

export const cacheService = new CacheService();
