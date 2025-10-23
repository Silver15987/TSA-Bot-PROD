import { database } from '../../../database/client';
import logger from '../../../core/logger';

/**
 * Streak Manager
 * Manages daily activity streaks for users
 */
export class StreakManager {
  /**
   * Update user's daily streak
   */
  async updateStreak(userId: string, guildId: string): Promise<void> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });

      if (!user) {
        logger.warn(`Cannot update streak: User ${userId} not found in guild ${guildId}`);
        return;
      }

      const today = this.getDateOnly(new Date());
      const lastActive = this.getDateOnly(new Date(user.lastActiveDate));

      const daysDiff = this.getDaysDifference(lastActive, today);

      if (daysDiff === 0) {
        return;
      } else if (daysDiff === 1) {
        const newStreak = user.currentStreak + 1;
        const newLongest = Math.max(newStreak, user.longestStreak);

        await database.users.updateOne(
          { id: userId, guildId },
          {
            $set: {
              currentStreak: newStreak,
              longestStreak: newLongest,
              lastActiveDate: new Date(),
            },
          }
        );

        logger.info(`User ${userId} streak incremented to ${newStreak} days`);
      } else {
        await database.users.updateOne(
          { id: userId, guildId },
          {
            $set: {
              currentStreak: 1,
              lastActiveDate: new Date(),
            },
          }
        );

        logger.info(`User ${userId} streak reset to 1 day (missed ${daysDiff - 1} days)`);
      }
    } catch (error) {
      logger.error(`Failed to update streak for user ${userId}:`, error);
    }
  }

  /**
   * Get date only (without time) for comparison
   */
  private getDateOnly(date: Date): Date {
    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);
    return dateOnly;
  }

  /**
   * Calculate difference in days between two dates
   */
  private getDaysDifference(date1: Date, date2: Date): number {
    const diffMs = date2.getTime() - date1.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  /**
   * Check if user was active today
   */
  async wasActiveToday(userId: string, guildId: string): Promise<boolean> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });

      if (!user) {
        return false;
      }

      const today = this.getDateOnly(new Date());
      const lastActive = this.getDateOnly(new Date(user.lastActiveDate));

      return today.getTime() === lastActive.getTime();
    } catch (error) {
      logger.error(`Failed to check if user ${userId} was active today:`, error);
      return false;
    }
  }

  /**
   * Get current streak for a user
   */
  async getCurrentStreak(userId: string, guildId: string): Promise<number> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      return user?.currentStreak || 0;
    } catch (error) {
      logger.error(`Failed to get current streak for user ${userId}:`, error);
      return 0;
    }
  }
}

export const streakManager = new StreakManager();
