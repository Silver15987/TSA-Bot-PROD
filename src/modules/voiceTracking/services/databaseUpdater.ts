import { database } from '../../../database/client';
import { QuestDocument } from '../../../types/database';

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
          `Micro-transaction filtered for user ${userId}: Duration ${Math.floor(duration / 1000)}s (<5s threshold) - not saved to database`
        );
        return;
      }

      const coinsEarned = await coinCalculator.calculateCoins(duration, guildId, userId);

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
      const coinsEarned = await coinCalculator.calculateCoins(incrementalDuration, guildId, session.userId);

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
      // Determine reset boundary using the same logic as DailyResetManager:
      // start of the current day in UTC (this matches lastDailyReset after a reset).
      const boundaryDate = new Date(today);
      boundaryDate.setUTCHours(0, 0, 0, 0);
      const resetBoundary = boundaryDate.getTime();

      const sessionStart = session.sessionStartTime;
      const sessionEnd = today.getTime();

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

    // ========================================
    // ATOMIC OPERATION: Update balance and create transaction
    // ========================================
    // While we can't use true ACID transactions in Cosmos DB (MongoDB API),
    // we can ensure consistency through careful ordering and error handling

    let transactionId: string | null = null;

    try {
      const updatedUser = await database.users.findOneAndUpdate(
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
            // Initialize status and multiplier fields
            statuses: [],
            items: [],
            multiplierEnabled: true,
            // Initialize role fields
            role: null,
            roleProgress: [],
            roleCooldowns: [],
          },
        },
        {
          upsert: true,
          returnDocument: 'after',
        }
      );

      if (!updatedUser) {
        // This should not happen with upsert:true, but handle defensively
        logger.error(`CRITICAL: User ${userId} not found after upsert/update`);
        throw new Error(`User ${userId} not found after update`);
      }

      const balanceAfter = updatedUser.coins ?? 0;
      // Create transaction record (use updateOne with upsert for idempotency)
      transactionId = this.generateTransactionId();
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
      // Either the user update or the transaction write failed.
      // If the user update succeeded but the transaction failed, log a ledger inconsistency.
      logger.error(
        transactionId
          ? `LEDGER INCONSISTENCY: User ${userId} balance updated (+${coinsEarned}) but transaction ${transactionId} failed to create:`
          : `CRITICAL: Failed to update user ${userId} balance and/or create transaction:`,
        error
      );
      // Don't throw - best effort; user balance update may have succeeded and we avoid crashing callers.
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
   * Bulk save sessions
   * Optimized for high-concurrency environments to reduce DB round-trips
   */
  async saveSessionsBulk(sessions: VCSession[], guildId: string): Promise<void> {
    if (sessions.length === 0) return;

    const today = new Date();

    // 1. Fetch all users, factions, and quests in parallel
    const userIds = sessions.map(s => s.userId);
    const factionIds = [...new Set(sessions.map(s => s.factionId).filter((id): id is string => !!id))];

    const [users, _, activeQuests] = await Promise.all([
      database.users.find({ id: { $in: userIds }, guildId }).toArray(),
      database.factions.find({ id: { $in: factionIds }, guildId }).toArray(),
      database.quests.find({
        guildId,
        factionId: { $in: factionIds },
        status: { $in: ['active', 'offered'] }
      }).toArray()
    ]);

    const userMap = new Map(users.map(u => [u.id, u]));

    // Fix: Handle duplicate active quests by picking the latest one (deterministic)
    const questMap = new Map<string, QuestDocument>();
    for (const quest of activeQuests) {
      if (!quest.factionId) continue;
      const existing = questMap.get(quest.factionId);
      if (!existing || quest.createdAt > existing.createdAt) {
        questMap.set(quest.factionId, quest);
      }
    }

    // Prepare bulk operations
    const userOps: any[] = [];
    const transactionOps: any[] = [];
    const vcActivityOps: any[] = [];
    const factionOps: any[] = [];
    const questOps: any[] = [];
    const redisUpdates: { userId: string, duration: number }[] = [];

    // Aggregations
    const factionUpdates = new Map<string, { vcTime: number, xp: number }>();
    const questUpdates = new Map<string, { progress: number, contributors: Map<string, number> }>();

    // Fix: Maintain running balances for transactions
    const userRunningBalances = new Map<string, number>();
    for (const user of users) {
      userRunningBalances.set(user.id, user.coins || 0);
    }
    // Initialize for new users (assumed 0)
    for (const userId of userIds) {
      if (!userRunningBalances.has(userId)) {
        userRunningBalances.set(userId, 0);
      }
    }

    for (const session of sessions) {
      try {
        const incrementalDuration = sessionManager.calculateIncrementalDuration(session);
        if (incrementalDuration <= 0) continue;

        const coinsEarned = await coinCalculator.calculateCoins(incrementalDuration, guildId, session.userId);

        // --- User Logic ---
        const user = userMap.get(session.userId);

        let dailyPeriodTime = incrementalDuration;
        let weeklyPeriodTime = incrementalDuration;
        let monthlyPeriodTime = incrementalDuration;
        let dailyPeriodCoins = coinsEarned;
        let weeklyPeriodCoins = coinsEarned;
        let monthlyPeriodCoins = coinsEarned;

        if (user && user.lastDailyReset) {
          // Implementation note: We currently do not split time across boundaries in bulk mode.
          // We rely on the eventual consistency of the daily reset trigger.
        }

        const userInc: any = {
          totalVcTime: incrementalDuration,
          coins: coinsEarned,
          totalCoinsEarned: coinsEarned,
          dailyVcTime: dailyPeriodTime,
          weeklyVcTime: weeklyPeriodTime,
          monthlyVcTime: monthlyPeriodTime,
          dailyCoinsEarned: dailyPeriodCoins,
          weeklyCoinsEarned: weeklyPeriodCoins,
          monthlyCoinsEarned: monthlyPeriodCoins,
        };

        if (session.factionId) {
          userInc.factionVcTime = incrementalDuration;
          userInc.lifetimeFactionVcTime = incrementalDuration;
        }

        userOps.push({
          updateOne: {
            filter: { id: session.userId, guildId },
            update: {
              $inc: userInc,
              $set: {
                lastActiveDate: today,
                updatedAt: today
              },
              $setOnInsert: {
                lastDailyReset: today, // New users start fresh
                lastWeeklyReset: today,
                lastMonthlyReset: today,
                statuses: [],
                items: [],
                multiplierEnabled: true,
                role: null,
                roleProgress: [],
                roleCooldowns: [],
                guildId,
              }
            },
            upsert: true
          }
        });

        // --- Transactions ---
        // Fix: Idempotency & Running Balance
        const currentBalance = userRunningBalances.get(session.userId) || 0;
        const newBalance = currentBalance + coinsEarned;
        userRunningBalances.set(session.userId, newBalance);

        const txId = this.generateTransactionId();
        transactionOps.push({
          updateOne: {
            filter: { id: txId },
            update: {
              $set: {
                userId: session.userId,
                type: 'vctime_earn',
                amount: coinsEarned,
                balanceAfter: newBalance,
                metadata: {
                  duration: incrementalDuration,
                  channelId: session.channelId,
                  factionId: session.factionId,
                  guildId
                },
                createdAt: today
              }
            },
            upsert: true
          }
        });

        // --- VC Activity ---
        const normalizedDate = this.getStartOfDay(today);
        const channelType = session.factionId ? 'faction' : 'general';

        vcActivityOps.push({
          updateOne: {
            filter: { id: `session_${session.userId}_${session.sessionStartTime}` },
            update: {
              $set: {
                userId: session.userId,
                guildId,
                startTime: new Date(session.sessionStartTime),
                endTime: today,
                channelId: session.channelId,
                channelType,
                factionId: session.factionId ?? null,
                date: normalizedDate,
              },
              $inc: {
                duration: incrementalDuration,
                coinsEarned: coinsEarned
              },
              $setOnInsert: {
                createdAt: today
              }
            },
            upsert: true
          }
        });

        // --- Aggregates for Faction/Quest ---
        if (session.factionId) {
          // Faction Stats
          const fUpdate = factionUpdates.get(session.factionId) || { vcTime: 0, xp: 0 };
          fUpdate.vcTime += incrementalDuration;
          fUpdate.xp += incrementalDuration;
          factionUpdates.set(session.factionId, fUpdate);

          // Quest Progress
          const quest = questMap.get(session.factionId);
          if (quest && quest.type === 'collective_vc_time') {
            const qUpdate = questUpdates.get(quest.id) || { progress: 0, contributors: new Map() };
            qUpdate.progress += incrementalDuration;
            const contrib = qUpdate.contributors.get(session.userId) || 0;
            qUpdate.contributors.set(session.userId, contrib + incrementalDuration);
            questUpdates.set(quest.id, qUpdate);
          }
        }

        // --- Redis Update Prep ---
        redisUpdates.push({
          userId: session.userId,
          duration: sessionManager.calculateDuration(session)
        });

      } catch (error) {
        logger.error(`Error processing bulk session for user ${session.userId}`, error);
      }
    }

    // --- EXECUTE BULK OPS ---
    const promises: Promise<any>[] = [];

    // Helper to tag promises for logging
    const trackOp = (promise: Promise<any>, name: string, count: number) =>
      promise.then(res => ({ status: 'fulfilled', name, count, res }))
        .catch(err => ({ status: 'rejected', name, count, err }));

    if (userOps.length > 0) promises.push(trackOp(database.users.bulkWrite(userOps), 'users', userOps.length));
    if (transactionOps.length > 0) promises.push(trackOp(database.transactions.bulkWrite(transactionOps), 'transactions', transactionOps.length));
    if (vcActivityOps.length > 0) promises.push(trackOp(database.vcActivity.bulkWrite(vcActivityOps), 'vcActivity', vcActivityOps.length));

    // Faction Updates
    factionUpdates.forEach((hashes, factionId) => {
      factionOps.push({
        updateOne: {
          filter: { id: factionId, guildId },
          update: {
            $inc: {
              totalFactionVcTime: hashes.vcTime,
              totalVcTime: hashes.vcTime,
              pendingVcXp: hashes.xp
            },
            $set: { updatedAt: today }
          }
        }
      });
    });
    if (factionOps.length > 0) promises.push(trackOp(database.factions.bulkWrite(factionOps), 'factions', factionOps.length));

    // Quest Updates
    questUpdates.forEach((data, questId) => {
      const updateObj: any = {
        $inc: { currentProgress: data.progress },
        $set: { updatedAt: today }
      };
      data.contributors.forEach((amount, userId) => {
        updateObj.$inc = updateObj.$inc || {};
        updateObj.$inc[`contributorStats.${userId}.contribution`] = amount;
        updateObj.$set = updateObj.$set || {};
        updateObj.$set[`contributorStats.${userId}.userId`] = userId;
      });

      questOps.push({
        updateOne: {
          filter: { id: questId, guildId },
          update: updateObj
        }
      });
    });
    if (questOps.length > 0) promises.push(trackOp(database.quests.bulkWrite(questOps), 'quests', questOps.length));

    // Redis Updates
    if (redisUpdates.length > 0) {
      promises.push(trackOp(sessionManager.updateLastSavedDurationBulk(redisUpdates, guildId), 'redis', redisUpdates.length));
    }

    const results = await Promise.allSettled(promises);

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        const val = result.value as any; // { status, name, count, res/err }
        if (val.status === 'rejected') {
          logger.error(`Bulk op failed: ${val.name} (${val.count} ops)`, val.err);
        } else {
          logger.debug(`Bulk op success: ${val.name} (${val.count} ops)`);
        }
      } else {
        logger.error('Critical failure in bulk operation wrapper', result.reason);
      }
    });

    logger.info(`Bulk save completed for ${sessions.length} sessions`);
  }

  /**
   * Generate unique transaction ID
   */
  private generateTransactionId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

export const databaseUpdater = new DatabaseUpdater();
