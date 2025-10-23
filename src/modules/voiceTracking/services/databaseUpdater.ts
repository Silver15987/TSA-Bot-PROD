import { database } from '../../../database/client';
import logger from '../../../core/logger';
import { sessionManager } from './sessionManager';
import { coinCalculator } from './coinCalculator';
import { streakManager } from './streakManager';
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

      await streakManager.updateStreak(userId, guildId);

      await sessionManager.deleteSession(userId, guildId);

      logger.info(
        `Session ended for user ${userId}: Duration ${Math.floor(duration / 1000)}s, Coins: ${coinsEarned}${session.factionId ? `, Faction: ${session.factionId}` : ''}`
      );
    } catch (error) {
      logger.error(`Failed to save and end session for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Save session data incrementally (without ending session)
   * Used by periodic sync
   */
  async saveSessionIncremental(session: VCSession, guildId: string, username?: string): Promise<void> {
    try {
      const duration = sessionManager.calculateDuration(session);
      const coinsEarned = coinCalculator.calculateCoins(duration, guildId);

      await this.saveSessionData(session.userId, guildId, duration, coinsEarned, session, username);

      // If session is in a faction VC, update faction stats
      if (session.factionId) {
        await factionStatsTracker.updateFactionVcTime(
          session.factionId,
          guildId,
          session.userId,
          duration
        );
      }

      await sessionManager.updateSessionTimestamp(session.userId, guildId, Date.now());

      logger.debug(
        `Incremental save for user ${session.userId}: Duration ${Math.floor(duration / 1000)}s, Coins: ${coinsEarned}${session.factionId ? `, Faction: ${session.factionId}` : ''}`
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

    const setFields: any = {
      lastActiveDate: today,
      updatedAt: today,
    };

    // Update username if provided
    if (username) {
      setFields.username = username;
    }

    await database.users.updateOne(
      { id: userId, guildId },
      {
        $inc: {
          totalVcTime: duration,
          dailyVcTime: duration,
          weeklyVcTime: duration,
          monthlyVcTime: duration,
          coins: coinsEarned,
          totalCoinsEarned: coinsEarned,
          dailyCoinsEarned: coinsEarned,
          weeklyCoinsEarned: coinsEarned,
          monthlyCoinsEarned: coinsEarned,
        },
        $set: setFields,
      },
      { upsert: true }
    );

    const userAfterUpdate = await database.users.findOne({ id: userId, guildId });
    const balanceAfter = userAfterUpdate?.coins || 0;

    await database.transactions.insertOne({
      id: this.generateTransactionId(),
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
    });
  }

  /**
   * Generate unique transaction ID
   */
  private generateTransactionId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

export const databaseUpdater = new DatabaseUpdater();
