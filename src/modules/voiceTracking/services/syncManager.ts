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
    // updated the cron job from every 1 minute (for testing)
    this.task = cron.schedule('*/1 * * * *', async () => {
      await this.syncAllActiveSessions(client);
    });

    logger.info('Periodic sync manager started (runs every 1 minute -- testing)');
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
        if (sessions.length === 0) {
          logger.debug('No active sessions to sync');
          return;
        }

        // Bulk fetch all members to validate their VC state
        const userIds = sessions.map(s => s.userId);
        let members;
        try {
          members = await guild.members.fetch({ user: userIds });
        } catch (error) {
          logger.error('Failed to bulk fetch members', error);
          // Fallback: Proceed with what we have? Or abort? 
          // Abort is safer to avoid assuming everyone left VC.
          return;
        }

        const validSessions: typeof sessions = [];
        const staleSessionUserIds: string[] = [];
        const sessionsToTransfer: { userId: string; newChannelId: string; factionId?: string }[] = [];

        // Get tracked categories once
        const trackedCategories = categoryValidator.getTrackedCategoryIds(guild.id);
        const { factionStatsTracker } = await import('../../factions/services/factionStatsTracker');

        for (const session of sessions) {
          const member = members.get(session.userId);

          // Validation 1: Member must exist and be in a VC
          if (!member || !member.voice.channelId) {
            logger.warn(`Cleaning stale session for user ${session.userId} (not in VC)`);
            staleSessionUserIds.push(session.userId);
            continue;
          }

          // Validation 2: Check for channel mismatch (Hopping)
          if (member.voice.channelId !== session.channelId) {
            // Check if the NEW channel is tracked
            // We need the channel object to check the parentId
            const voiceChannel = member.voice.channel;
            const isTracked = voiceChannel && voiceChannel.parentId && trackedCategories.includes(voiceChannel.parentId);

            if (isTracked) {
              logger.info(
                `User ${session.userId} moved from ${session.channelId} to ${member.voice.channelId} (Tracked). Transforming session.`
              );

              // 1. Queue old session for stats saving (so we don't lose the time spent in the old channel)
              // We use the OLD channel ID from the session object, so stats are attributed correctly.
              validSessions.push(session);

              // 2. Queue transfer to update Redis to the new channel
              // We need to check if the new channel is a faction channel
              // This is async, but we can't await in loop efficiently? 
              // Actually, we can check faction status quickly if we preload or cache it.
              // For now, we'll let transferSession handle logic or just pass null and let it figure it out?
              // SessionManager.transferSession just updates fields.
              // We might miss factionId update if we don't check.
              // Solution: We should mark this for transfer, and let handleTransfers do the lookup.
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

        // Bulk save valid sessions (includes those who moved, saving their OLD channel stats)
        if (validSessions.length > 0) {
          await databaseUpdater.saveSessionsBulk(validSessions, guild.id);
          totalSynced += validSessions.length;
        }

        // Handle Transfers (Update Redis to new channel)
        // We do this AFTER saving, so the next sync will start counting from NOW for the NEW channel.
        // We should also check for Faction ID for the new channel.
        for (const transfer of sessionsToTransfer) {
          const isFaction = await factionStatsTracker.isFactionChannel(transfer.newChannelId, guild.id);
          const factionId = isFaction ? await factionStatsTracker.getFactionByChannelId(transfer.newChannelId, guild.id) : undefined;

          await sessionManager.transferSession(
            transfer.userId,
            guild.id,
            transfer.newChannelId,
            factionId || undefined // Ensure undefined if null
          );
        }

      } catch (error) {
        logger.error(`Failed to sync sessions for guild ${guild.id}:`, error);
      }

      // Process pending VC XP conversions for factions
      try {
        const { factionStatsTracker } = await import('../../factions/services/factionStatsTracker');
        await factionStatsTracker.processPendingVcXpForAllFactions(guild.id);
      } catch (error) {
        logger.error('Error processing pending VC XP:', error);
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
