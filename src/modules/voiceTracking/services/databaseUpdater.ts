import { database } from '../../../database/client';
import logger from '../../../core/logger';
import { sessionManager } from './sessionManager';
import { coinCalculator } from './coinCalculator';
import { streakManager } from './streakManager';
import { dailyResetManager } from './dailyResetManager';
import { factionStatsTracker } from '../../factions/services/factionStatsTracker';
import { VCSession } from '../types';

/**
 * Database Updater
 * Saves VC session data to Cosmos DB
 */
export class DatabaseUpdater {
  /**
   * Save session to database and end it
   */
  async saveAndEndSession(userId: string, guildId: string, username?: string): Promise<void> {
    try {
      const session = await sessionManager.getSession(userId, guildId);

      if (!session) {
        logger.warn(`Cannot save session: No active session for user ${userId}`);
        return;
      }

      const duration = sessionManager.calculateDuration(session);

      // Filter micro-transactions: Don't save sessions shorter than 5 seconds
      if (duration < 5000) {
        await sessionManager.deleteSession(userId, guildId);
        logger.info(
          `Micro-transaction filtered for user ${userId}: Duration ${Math.floor(duration / 1000)}s (< 5s threshold) - not saved to database`
        );
        return;
      }

      const coinsEarned = coinCalculator.calculateCoins(duration, guildId);

      await this.saveSessionData(userId, guildId, duration, coinsEarned, session, username);

      // If session was in a faction VC, update faction stats
      if (session.factionId) {
        await factionStatsTracker.updateFactionVcTime(
          session.factionId,
          guildId,
          userId,
          duration
        );

        // Update quest progress for VC time quests
        try {
          const { questProgressTracker } = await import('../../quests/services/questProgressTracker');
          await questProgressTracker.trackVcTimeContribution(userId, guildId, session.factionId, duration);
        } catch (error) {
          logger.error('Error tracking quest VC time contribution:', error);
        }
      }

      // Update daily streak (wrapped to prevent crashes)
      try {
        await streakManager.updateStreak(userId, guildId);
      } catch (error) {
        logger.error(`Error updating streak for user ${userId}:`, error);
        // Don't let streak update failure crash session save
      }

      await sessionManager.deleteSession(userId, guildId);

      logger.info(
        `Session ended for user ${userId}: Duration ${Math.floor(duration / 1000)}s, Coins: ${coinsEarned}${session.factionId ? `, Faction: ${session.factionId}` : ''}`
      );
    } catch (error) {
      logger.error(`Failed to save and end session for user ${userId}:`, error);
      // Don't re-throw - error is logged, let caller continue
    }
  }

  /**
   * Save session data incrementally (without ending session)
   * Used by periodic sync
   */
  async saveSessionIncremental(session: VCSession, guildId: string, username?: string): Promise<void> {
    try {
      // CRITICAL: Use incremental duration to prevent double-counting
      // calculateIncrementalDuration returns only NEW time since last save
      const incrementalDuration = sessionManager.calculateIncrementalDuration(session);
      const coinsEarned = coinCalculator.calculateCoins(incrementalDuration, guildId);

      await this.saveSessionData(session.userId, guildId, incrementalDuration, coinsEarned, session, username);

      // If session is in a faction VC, update faction stats
      if (session.factionId) {
        await factionStatsTracker.updateFactionVcTime(
          session.factionId,
          guildId,
          session.userId,
          incrementalDuration
        );

        // Update quest progress for VC time quests
        try {
          const { questProgressTracker } = await import('../../quests/services/questProgressTracker');
          await questProgressTracker.trackVcTimeContribution(session.userId, guildId, session.factionId, incrementalDuration);
        } catch (error) {
          logger.error('Error tracking quest VC time contribution:', error);
        }
      }

      // Update lastSavedDuration to current total (prevents double-counting next save)
      const currentTotalDuration = sessionManager.calculateDuration(session);
      await sessionManager.updateLastSavedDuration(session.userId, guildId, currentTotalDuration);

      logger.debug(
        `Incremental save for user ${session.userId}: Duration ${Math.floor(incrementalDuration / 1000)}s, Coins: ${coinsEarned}${session.factionId ? `, Faction: ${session.factionId}` : ''}`
      );
    } catch (error) {
      logger.error(`Failed to save session incrementally for user ${session.userId}:`, error);
    }
  }

  /**
   * Save session data to database
   */
  private async saveSessionData(
    userId: string,
    guildId: string,
    duration: number,
    coinsEarned: number,
    session: VCSession,
    username?: string
  ): Promise<void> {
    const today = new Date();

    // ========================================
    // CHECK AND RESET BEFORE UPDATING STATS
    // ========================================
    let resetOccurred = false;
    try {
      const resetInfo = await dailyResetManager.checkAndResetUser(userId, guildId);
      resetOccurred = resetInfo.daily || resetInfo.weekly || resetInfo.monthly;
    } catch (error) {
      logger.error(`Error checking/resetting user ${userId}:`, error);
      // Continue with session save - don't let reset failure block it
    }

    const setFields: any = {
      lastActiveDate: today,
      updatedAt: today,
    };

    // Update username if provided
    if (username) {
      setFields.username = username;
    }

    // ========================================
    // HANDLE SESSIONS SPANNING RESET BOUNDARIES
    // ========================================
    // If a reset occurred, we need to split the session duration between
    // the old period (before reset) and new period (after reset).
    // The totalVcTime gets the full duration, but daily/weekly/monthly
    // only get the portion from the current period.

    let dailyDuration = duration;
    let weeklyDuration = duration;
    let monthlyDuration = duration;
    let dailyCoins = coinsEarned;
    let weeklyCoins = coinsEarned;
    let monthlyCoins = coinsEarned;

    if (resetOccurred) {
      // Get user's current reset timestamps to determine boundary
      const user = await database.users.findOne({ id: userId, guildId });

      if (user && user.lastDailyReset) {
        const sessionStart = session.sessionStartTime;
        const sessionEnd = today.getTime();

        // Calculate time in new period (after reset)
        const resetBoundary = new Date(user.lastDailyReset).getTime();

        if (sessionStart < resetBoundary && sessionEnd > resetBoundary) {
          // Session spans the reset boundary
          const timeInNewPeriod = sessionEnd - resetBoundary;
          const timeInOldPeriod = resetBoundary - sessionStart;

          // Only count time from new period for daily/weekly/monthly
          dailyDuration = timeInNewPeriod;
          weeklyDuration = timeInNewPeriod;
          monthlyDuration = timeInNewPeriod;

          // Split coins proportionally
          const proportionInNewPeriod = timeInNewPeriod / duration;
          dailyCoins = Math.round(coinsEarned * proportionInNewPeriod);
          weeklyCoins = Math.round(coinsEarned * proportionInNewPeriod);
          monthlyCoins = Math.round(coinsEarned * proportionInNewPeriod);

          logger.info(
            `Session for user ${userId} spans reset boundary: ` +
            `${Math.floor(timeInOldPeriod / 1000)}s in old period, ` +
            `${Math.floor(timeInNewPeriod / 1000)}s in new period`
          );
        }
      }
    }

    // ========================================
    // ATOMIC OPERATION: Update balance and create transaction
    // ========================================
    // While we can't use true ACID transactions in Cosmos DB (MongoDB API),
    // we can ensure consistency through careful ordering and error handling

    let userUpdateResult;
    try {
      userUpdateResult = await database.users.updateOne(
        { id: userId, guildId },
        {
          $inc: {
            totalVcTime: duration,
            dailyVcTime: dailyDuration,
            weeklyVcTime: weeklyDuration,
            monthlyVcTime: monthlyDuration,
            coins: coinsEarned,
            totalCoinsEarned: coinsEarned,
            dailyCoinsEarned: dailyCoins,
            weeklyCoinsEarned: weeklyCoins,
            monthlyCoinsEarned: monthlyCoins,
          },
          $set: setFields,
          $setOnInsert: {
            // Initialize reset timestamps for new users created via auto-upsert
            lastDailyReset: today,
            lastWeeklyReset: today,
            lastMonthlyReset: today,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      logger.error(`CRITICAL: Failed to update user ${userId} balance:`, error);
      throw error; // Re-throw to prevent transaction creation
    }

    // Verify the update succeeded
    if (!userUpdateResult.acknowledged) {
      throw new Error(`User update not acknowledged for ${userId}`);
    }

    // Get updated balance for transaction record
    const userAfterUpdate = await database.users.findOne({ id: userId, guildId });
    if (!userAfterUpdate) {
      // This should never happen if update succeeded, but handle it
      logger.error(`CRITICAL: User ${userId} not found after successful update`);
      throw new Error(`User ${userId} not found after update`);
    }
    const balanceAfter = userAfterUpdate.coins;

    // Create transaction record (use updateOne with upsert for idempotency)
    const transactionId = this.generateTransactionId();
    try {
      await database.transactions.updateOne(
        { id: transactionId },
        {
          $set: {
            userId,
            type: 'vctime_earn',
            amount: coinsEarned,
            balanceAfter,
            metadata: {
              duration,
              channelId: session.channelId,
              factionId: session.factionId,
              guildId,
            },
            createdAt: today,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      // Transaction record failed to create
      // Balance was already updated - log this as a ledger inconsistency
      logger.error(
        `LEDGER INCONSISTENCY: User ${userId} balance updated (+${coinsEarned}) ` +
        `but transaction ${transactionId} failed to create:`,
        error
      );
      // Don't throw - balance update succeeded, user got coins
      // Transaction record is supplementary
    }

    // ========================================
    // SAVE INDIVIDUAL SESSION TO VC ACTIVITY
    // ========================================
    await this.saveVcActivityRecord(userId, guildId, duration, coinsEarned, session, today);
  }

  /**
   * Save individual session record to vcActivity collection
   */
  private async saveVcActivityRecord(
    userId: string,
    guildId: string,
    duration: number,
    coinsEarned: number,
    session: VCSession,
    endTime: Date
  ): Promise<void> {
    try {
      const startTime = new Date(session.sessionStartTime);
      const normalizedDate = this.getStartOfDay(endTime);

      // Determine channel type
      const channelType: 'faction' | 'general' = session.factionId ? 'faction' : 'general';

      // Use updateOne with upsert to prevent duplicate key errors if same session saved twice
      await database.vcActivity.updateOne(
        { id: `session_${userId}_${session.sessionStartTime}` },
        {
          $set: {
            userId,
            guildId,
            startTime,
            endTime,
            duration,
            channelId: session.channelId,
            channelType,
            factionId: session.factionId ?? null, // Handle undefined -> null conversion
            coinsEarned,
            date: normalizedDate,
            createdAt: endTime,
          },
        },
        { upsert: true }
      );

      logger.debug(`Saved VC activity record for user ${userId}: ${duration}ms in channel ${session.channelId}`);
    } catch (error) {
      logger.error(`Error saving VC activity record for user ${userId}:`, error);
      // Don't throw - this is supplementary data, don't fail the whole session save
    }
  }

  /**
   * Get start of day (00:00:00 UTC) for date normalization
   */
  private getStartOfDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Generate unique transaction ID
   */
  private generateTransactionId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

export const databaseUpdater = new DatabaseUpdater();
