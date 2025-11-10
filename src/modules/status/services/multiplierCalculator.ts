import { database } from '../../../database/client';
import { multiplierCacheService } from './multiplierCacheService';
import { statusService } from './statusService';
import logger from '../../../core/logger';

/**
 * Multiplier Calculator Service
 * Calculates total multipliers (faction × user) with Redis caching and fallback
 */
export class MultiplierCalculator {
  /**
   * Calculate total multiplier for a user
   * Returns factionMultiplier × userMultiplier, or 1.0 if multipliers disabled or unavailable
   */
  async calculateTotalMultiplier(userId: string, guildId: string): Promise<number> {
    try {
      // Check cache first
      const cachedTotal = await multiplierCacheService.getTotalMultiplierFromCache(userId, guildId);
      if (cachedTotal !== null) {
        return cachedTotal;
      }

      // Get user to check multiplierEnabled flag
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        logger.debug(`User ${userId} not found, returning default multiplier 1.0`);
        return 1.0;
      }

      // Check if multipliers are enabled for this user
      if (user.multiplierEnabled === false) {
        // Cache the result (disabled = 1.0)
        await multiplierCacheService.setTotalMultiplierCache(userId, guildId, 1.0);
        return 1.0;
      }

      // Calculate faction multiplier
      const factionMultiplier = await this.getFactionMultiplier(user, guildId);

      // Calculate user multiplier
      const userMultiplier = await this.getUserMultiplier(user, guildId);

      // Calculate total: faction × user
      const totalMultiplier = factionMultiplier * userMultiplier;

      // Cache the result
      await multiplierCacheService.setTotalMultiplierCache(userId, guildId, totalMultiplier);

      logger.debug(`Calculated total multiplier for user ${userId}: ${totalMultiplier} (faction: ${factionMultiplier}, user: ${userMultiplier})`);
      return totalMultiplier;
    } catch (error) {
      logger.error(`Error calculating total multiplier for user ${userId}:`, error);
      // Return 1.0 on error (no multiplier effect)
      return 1.0;
    }
  }

  /**
   * Get faction multiplier for a user
   * Falls back through: Redis cache → DB → default 1.0
   */
  private async getFactionMultiplier(user: any, guildId: string): Promise<number> {
    try {
      // If user has no faction, return 1.0
      if (!user.currentFaction) {
        return 1.0;
      }

      const factionId = user.currentFaction;

      // Try Redis cache first
      const cached = await multiplierCacheService.getFactionMultiplierFromCache(factionId, guildId);
      if (cached !== null) {
        return cached;
      }

      // Fall back to DB
      const faction = await database.factions.findOne({ id: factionId, guildId });
      if (!faction) {
        logger.debug(`Faction ${factionId} not found, returning default multiplier 1.0`);
        return 1.0;
      }

      // Get multiplier from faction (default to 1.0 if not set)
      const multiplier = faction.coinMultiplier ?? 1.0;

      // Cache it
      await multiplierCacheService.setFactionMultiplierCache(factionId, guildId, multiplier);

      return multiplier;
    } catch (error) {
      logger.warn(`Error getting faction multiplier:`, error);
      return 1.0;
    }
  }

  /**
   * Get user multiplier from statuses and items
   * Falls back through: Redis cache → DB calculation → default 1.0
   */
  private async getUserMultiplier(user: any, guildId: string): Promise<number> {
    try {
      // Try Redis cache first
      const cached = await multiplierCacheService.getUserMultiplierFromCache(user.id, guildId);
      if (cached !== null) {
        return cached;
      }

      // Calculate from statuses and items
      let multiplier = 1.0;

      // Get active statuses
      const statuses = await statusService.getUserStatuses(user.id, guildId);
      for (const status of statuses) {
        multiplier *= status.multiplier;
      }

      // Get active items
      const items = await statusService.getUserItems(user.id, guildId);
      for (const item of items) {
        multiplier *= item.multiplier;
      }

      // Cache it
      await multiplierCacheService.setUserMultiplierCache(user.id, guildId, multiplier);

      return multiplier;
    } catch (error) {
      logger.warn(`Error getting user multiplier:`, error);
      return 1.0;
    }
  }
}

export const multiplierCalculator = new MultiplierCalculator();






