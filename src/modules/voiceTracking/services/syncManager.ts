import cron from 'node-cron';
import { BotClient } from '../../../core/client';
import { sessionManager } from './sessionManager';
import { databaseUpdater } from './databaseUpdater';
import { categoryValidator } from './categoryValidator';
import logger from '../../../core/logger';

/**
 * Sync Manager
 * Periodically saves active sessions to database
 */
export class SyncManager {
  private task: cron.ScheduledTask | null = null;
  private isRunning = false;

  /**
   * Start periodic sync task
   */
  start(client: BotClient): void {
    if (this.task) {
      logger.warn('Sync manager already running');
      return;
    }

    this.task = cron.schedule('*/5 * * * *', async () => {
      await this.syncAllActiveSessions(client);
    });

    logger.info('Periodic sync manager started (runs every 5 minutes)');
  }

  /**
   * Stop periodic sync task
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info('Periodic sync manager stopped');
    }
  }

  /**
   * Sync all active sessions across all guilds
   * Optimized for single-guild operation
   */
  async syncAllActiveSessions(client: BotClient): Promise<void> {
    if (this.isRunning) {
      logger.warn('Sync already in progress, skipping this run');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('Starting periodic VC session sync...');

      let totalSynced = 0;
      let totalCleaned = 0;

      // Get the single guild (optimized for single-guild operation)
      const guild = client.guilds.cache.first();
      if (!guild) {
        logger.warn('Sync Manager: Bot is not in any guilds, skipping sync');
        return;
      }

      try {
        if (!categoryValidator.isTrackingEnabled(guild.id)) {
          logger.debug('VC tracking is disabled, skipping sync');
          return;
        }

        const sessions = await sessionManager.getAllActiveSessions(guild.id);

        for (const session of sessions) {
          try {
            const member = await guild.members.fetch(session.userId).catch(() => null);

            if (!member || !member.voice.channelId) {
              logger.warn(`Cleaning stale session for user ${session.userId} (not in VC)`);
              await databaseUpdater.saveAndEndSession(session.userId, guild.id);
              totalCleaned++;
              continue;
            }

            if (member.voice.channelId !== session.channelId) {
              logger.warn(
                `Session channel mismatch for user ${session.userId}: ` +
                `Session: ${session.channelId}, Actual: ${member.voice.channelId}`
              );
              await databaseUpdater.saveAndEndSession(session.userId, guild.id);
              totalCleaned++;
              continue;
            }

            await databaseUpdater.saveSessionIncremental(session, guild.id);
            totalSynced++;
          } catch (error) {
            logger.error(`Failed to sync session for user ${session.userId}:`, error);
          }
        }
      } catch (error) {
        logger.error(`Failed to sync sessions for guild ${guild.id}:`, error);
      }

      logger.info(
        `Periodic sync complete: ${totalSynced} sessions synced, ${totalCleaned} stale sessions cleaned`
      );
    } catch (error) {
      logger.error('Error during periodic sync:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Force sync now (for manual trigger)
   */
  async forceSyncNow(client: BotClient): Promise<void> {
    logger.info('Manual sync triggered');
    await this.syncAllActiveSessions(client);
  }

  /**
   * Check if sync is currently running
   */
  isSyncing(): boolean {
    return this.isRunning;
  }
}

export const syncManager = new SyncManager();
