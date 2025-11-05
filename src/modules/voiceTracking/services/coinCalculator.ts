import { configManager } from '../../../core/configManager';
import { sessionManager } from './sessionManager';
import { multiplierCalculator } from '../../status/services/multiplierCalculator';
import logger from '../../../core/logger';

/**
 * Coin Calculator
 * Calculates coins earned based on time spent in VC
 */
export class CoinCalculator {
  /**
   * Calculate coins earned based on duration
   * @param durationMs Duration in milliseconds
   * @param guildId Guild ID
   * @param userId Optional user ID - if provided, multipliers will be applied
   */
  async calculateCoins(durationMs: number, guildId: string, userId?: string): Promise<number> {
    try {
      const config = configManager.getConfig(guildId);
      const coinsPerSecond = config.vcTracking.coinsPerSecond;

      const durationSeconds = Math.floor(durationMs / 1000);
      let coinsEarned = Math.floor(durationSeconds * coinsPerSecond);

      // Apply multipliers if userId is provided
      if (userId) {
        try {
          const multiplier = await multiplierCalculator.calculateTotalMultiplier(userId, guildId);
          coinsEarned = Math.floor(coinsEarned * multiplier);
        } catch (error) {
          logger.warn(`Failed to apply multiplier for user ${userId}, using base calculation:`, error);
          // Continue with base calculation if multiplier fails
        }
      }

      return coinsEarned;
    } catch (error) {
      logger.error(`Failed to calculate coins for guild ${guildId}:`, error);
      return 0;
    }
  }

  /**
   * Calculate coins for an active session (for display purposes)
   */
  async calculateCurrentSessionCoins(
    userId: string,
    guildId: string
  ): Promise<number> {
    try {
      const session = await sessionManager.getSession(userId, guildId);

      if (!session) {
        return 0;
      }

      const currentDuration = Date.now() - session.joinedAt;
      return await this.calculateCoins(currentDuration, guildId, userId);
    } catch (error) {
      logger.error(`Failed to calculate current session coins for user ${userId}:`, error);
      return 0;
    }
  }

  /**
   * Format coins with commas
   */
  formatCoins(coins: number): string {
    return coins.toLocaleString();
  }

  /**
   * Get coins per second rate for a guild
   */
  getCoinsPerSecond(guildId: string): number {
    const config = configManager.getConfig(guildId);
    return config.vcTracking.coinsPerSecond;
  }

  /**
   * Calculate expected earnings for a given duration
   * Note: This method does not apply multipliers (for display purposes, shows base rate)
   */
  async calculateExpectedEarnings(durationMs: number, guildId: string, userId?: string): Promise<{
    coins: number;
    perSecond: number;
    perMinute: number;
    perHour: number;
  }> {
    const perSecond = this.getCoinsPerSecond(guildId);
    const coins = await this.calculateCoins(durationMs, guildId, userId);

    return {
      coins,
      perSecond,
      perMinute: perSecond * 60,
      perHour: perSecond * 3600,
    };
  }
}

export const coinCalculator = new CoinCalculator();
