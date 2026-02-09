import cron from 'node-cron';
import { BotClient } from '../../../core/client';
import { sessionManager } from './sessionManager';
import { databaseUpdater } from './databaseUpdater';
import { categoryValidator } from './categoryValidator';
import logger from '../../../core/logger';
import { factionStatsTracker } from '../../factions/services/factionStatsTracker';

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
    // updated the cron job to production interval (5 minutes)
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
   */
  async syncAllActiveSessions(client: BotClient): Promise<void> {
    if (this.isRunning) {
      logger.warn('Sync already in progress, skipping this run');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('Starting periodic VC session sync...');

      const guilds = client.guilds.cache;
      let totalSynced = 0;
      let totalCleaned = 0;

      if (guilds.size === 0) {
        logger.warn('Sync Manager: Bot is not in any guilds, skipping sync');
        return;
      }

      for (const [_, guild] of guilds) {
        // Check if tracking enabled
        if (!categoryValidator.isTrackingEnabled(guild.id)) {
          logger.debug(`VC tracking is disabled for guild ${guild.id}, skipping sync`);
          continue;
        }

        try {
          // Ensure pending VC XP is processed regardless of active sessions
          try {
            await factionStatsTracker.processPendingVcXpForAllFactions(guild.id);
          } catch (error) {
            logger.error(`Failed to process pending VC XP for guild ${guild.id}`, error);
          }

          const sessions = await sessionManager.getAllActiveSessions(guild.id);

          if (sessions.length === 0) {
            logger.debug(`No active sessions to sync for guild ${guild.id}`);
            continue;
          }

          // Bulk fetch all members to validate their VC state
          const userIds = sessions.map(s => s.userId);
          let members;
          try {
            members = await guild.members.fetch({ user: userIds });
          } catch (error) {
            logger.error(`Failed to bulk fetch members for guild ${guild.id}`, error);
            continue;
          }

          const validSessions: typeof sessions = [];
          const staleSessionUserIds: string[] = [];
          const sessionsToTransfer: { userId: string; newChannelId: string; factionId?: string }[] = [];

          // Get tracked categories once
          const trackedCategories = categoryValidator.getTrackedCategoryIds(guild.id);

          for (const session of sessions) {
            const member = members.get(session.userId);

            // Validation 1: Member must exist and be in a VC
            if (!member || !member.voice.channelId) {
              logger.warn(`Cleaning stale session for user ${session.userId} in guild ${guild.id} (not in VC)`);
              staleSessionUserIds.push(session.userId);
              continue;
            }

            // Validation 2: Check for channel mismatch (Hopping)
            if (member.voice.channelId !== session.channelId) {
              // Check if the NEW channel is tracked
              const voiceChannel = member.voice.channel;
              const isTracked = voiceChannel && voiceChannel.parentId && trackedCategories.includes(voiceChannel.parentId);

              if (isTracked) {
                logger.info(
                  `User ${session.userId} moved from ${session.channelId} to ${member.voice.channelId} (Tracked). Transforming session.`
                );

                // 1. Queue old session for stats saving
                validSessions.push(session);

                // 2. Queue transfer to update Redis to the new channel
                sessionsToTransfer.push({
                  userId: session.userId,
                  newChannelId: member.voice.channelId
                });
              } else {
                logger.warn(
                  `User ${session.userId} moved to untracked channel ${member.voice.channelId}. Ending session.`
                );
                staleSessionUserIds.push(session.userId);
              }
              continue;
            }

            // No mismatch, valid session
            validSessions.push(session);
          }

          // Clean up stale sessions
          for (const userId of staleSessionUserIds) {
            await databaseUpdater.saveAndEndSession(userId, guild.id);
            totalCleaned++;
          }

          // Bulk save valid sessions
          if (validSessions.length > 0) {
            await databaseUpdater.saveSessionsBulk(validSessions, guild.id);
            totalSynced += validSessions.length;
          }

          // Handle Transfers
          for (const transfer of sessionsToTransfer) {
            const isFaction = await factionStatsTracker.isFactionChannel(transfer.newChannelId, guild.id);
            const factionId = isFaction ? await factionStatsTracker.getFactionByChannelId(transfer.newChannelId, guild.id) : undefined;

            await sessionManager.transferSession(
              transfer.userId,
              guild.id,
              transfer.newChannelId,
              factionId || undefined
            );
          }

        } catch (error) {
          logger.error(`Failed to sync sessions for guild ${guild.id}:`, error);
        }
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
