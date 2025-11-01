import { database } from '../../../database/client';
import { UserDocument } from '../../../types/database';
import logger from '../../../core/logger';

/**
 * Daily Reset Manager
 * Manages lazy resets for daily/weekly/monthly VC time and coin counters
 * Follows the same lazy evaluation pattern as streakManager
 */
export class DailyResetManager {
  /**
   * Check if user needs resets and perform them.
   * Returns which reset types occurred.
   */
  async checkAndResetUser(
    userId: string,
    guildId: string
  ): Promise<{ daily: boolean; weekly: boolean; monthly: boolean }> {
    const user = await database.users.findOne({ id: userId, guildId });
    if (!user) {
      return { daily: false, weekly: false, monthly: false };
    }

    const now = new Date();
    const updates: any = {};
    const resets = { daily: false, weekly: false, monthly: false };

    // Check daily reset
    if (this.shouldResetDaily(user.lastDailyReset, now)) {
      // Archive yesterday's data first
      await this.archiveDailyStats(userId, guildId, user);

      updates.dailyVcTime = 0;
      updates.dailyCoinsEarned = 0;
      updates.lastDailyReset = this.getStartOfDay(now);
      resets.daily = true;

      logger.info(`Daily reset for user ${userId} in guild ${guildId}`);
    }

    // Check weekly reset (Monday 00:00 UTC)
    if (this.shouldResetWeekly(user.lastWeeklyReset, now)) {
      updates.weeklyVcTime = 0;
      updates.weeklyCoinsEarned = 0;
      updates.lastWeeklyReset = this.getStartOfWeek(now);
      resets.weekly = true;

      logger.info(`Weekly reset for user ${userId} in guild ${guildId}`);
    }

    // Check monthly reset (1st of month 00:00 UTC)
    if (this.shouldResetMonthly(user.lastMonthlyReset, now)) {
      updates.monthlyVcTime = 0;
      updates.monthlyCoinsEarned = 0;
      updates.lastMonthlyReset = this.getStartOfMonth(now);
      resets.monthly = true;

      logger.info(`Monthly reset for user ${userId} in guild ${guildId}`);
    }

    // Apply resets if any occurred
    if (Object.keys(updates).length > 0) {
      await database.users.updateOne(
        { id: userId, guildId },
        { $set: updates }
      );
    }

    return resets;
  }

  /**
   * Check if daily reset is needed.
   */
  private shouldResetDaily(lastReset: Date | undefined, now: Date): boolean {
    if (!lastReset) {
      return true; // First time, need to initialize
    }

    const lastResetDay = this.getStartOfDay(lastReset);
    const currentDay = this.getStartOfDay(now);
    return currentDay.getTime() > lastResetDay.getTime();
  }

  /**
   * Check if weekly reset is needed (Monday 00:00 UTC).
   */
  private shouldResetWeekly(lastReset: Date | undefined, now: Date): boolean {
    if (!lastReset) {
      return true; // First time, need to initialize
    }

    const lastResetWeek = this.getStartOfWeek(lastReset);
    const currentWeek = this.getStartOfWeek(now);
    return currentWeek.getTime() > lastResetWeek.getTime();
  }

  /**
   * Check if monthly reset is needed (1st of month 00:00 UTC).
   */
  private shouldResetMonthly(lastReset: Date | undefined, now: Date): boolean {
    if (!lastReset) {
      return true; // First time, need to initialize
    }

    const lastResetMonth = this.getStartOfMonth(lastReset);
    const currentMonth = this.getStartOfMonth(now);
    return currentMonth.getTime() > lastResetMonth.getTime();
  }

  /**
   * Archive yesterday's daily stats to vcActivity collection.
   * Note: This method saves the SUMMARY of yesterday's stats.
   * Individual session records are saved in real-time by databaseUpdater.
   */
  private async archiveDailyStats(
    userId: string,
    guildId: string,
    user: UserDocument
  ): Promise<void> {
    try {
      // Only archive if there's actual data to save
      if (user.dailyVcTime === 0 && user.dailyCoinsEarned === 0) {
        return;
      }

      // Check if user has reset timestamp (safety check for new users)
      if (!user.lastDailyReset) {
        logger.warn(`User ${userId} has no lastDailyReset timestamp, skipping archive`);
        return;
      }

      const yesterday = new Date(user.lastDailyReset);
      const dateKey = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

      // Create a summary record for yesterday's total
      // This is separate from individual session records
      // Use updateOne with upsert to prevent duplicate key errors
      await database.vcActivity.updateOne(
        { id: `daily_summary_${userId}_${dateKey}` },
        {
          $set: {
            userId,
            guildId,
            startTime: this.getStartOfDay(yesterday),
            endTime: this.getEndOfDay(yesterday),
            duration: user.dailyVcTime,
            channelId: 'daily_summary', // Special marker for summary records
            channelType: 'general',
            factionId: null,
            coinsEarned: user.dailyCoinsEarned,
            date: this.getStartOfDay(yesterday),
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );

      logger.info(
        `Archived daily stats for user ${userId}: ` +
        `${user.dailyVcTime}ms VC, ${user.dailyCoinsEarned} coins`
      );
    } catch (error) {
      logger.error(`Error archiving daily stats for user ${userId}:`, error);
      // Don't throw - allow reset to proceed even if archive fails
    }
  }

  /**
   * Get start of day (00:00:00 UTC).
   */
  private getStartOfDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Get end of day (23:59:59.999 UTC).
   */
  private getEndOfDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(23, 59, 59, 999);
    return d;
  }

  /**
   * Get start of week (Monday 00:00:00 UTC).
   */
  private getStartOfWeek(date: Date): Date {
    const d = this.getStartOfDay(date);
    const day = d.getUTCDay();
    const diff = (day === 0 ? -6 : 1) - day; // Monday = start of week
    d.setUTCDate(d.getUTCDate() + diff);
    return d;
  }

  /**
   * Get start of month (1st day 00:00:00 UTC).
   */
  private getStartOfMonth(date: Date): Date {
    const d = this.getStartOfDay(date);
    d.setUTCDate(1);
    return d;
  }
}

export const dailyResetManager = new DailyResetManager();
