import { configManager } from '../../../core/configManager';
import { sessionManager } from './sessionManager';
import logger from '../../../core/logger';

/**
 * Coin Calculator
 * Calculates coins earned based on time spent in VC
 */
export class CoinCalculator {
  /**
   * Calculate coins earned based on duration
   */
  calculateCoins(durationMs: number, guildId: string): number {
    try {
      const config = configManager.getConfig(guildId);
      const coinsPerSecond = config.vcTracking.coinsPerSecond;

      const durationSeconds = Math.floor(durationMs / 1000);
      const coinsEarned = Math.floor(durationSeconds * coinsPerSecond);

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
      return this.calculateCoins(currentDuration, guildId);
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
   */
  calculateExpectedEarnings(durationMs: number, guildId: string): {
    coins: number;
    perSecond: number;
    perMinute: number;
    perHour: number;
  } {
    const perSecond = this.getCoinsPerSecond(guildId);
    const coins = this.calculateCoins(durationMs, guildId);

    return {
      coins,
      perSecond,
      perMinute: perSecond * 60,
      perHour: perSecond * 3600,
    };
  }
}

export const coinCalculator = new CoinCalculator();
