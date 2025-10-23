import cron from 'node-cron';
import { Client } from 'discord.js';
import { upkeepManager } from '../services/upkeepManager';
import logger from '../../../core/logger';

/**
 * Faction Upkeep Task
 * Runs daily at midnight UTC to process faction upkeep payments
 */

let upkeepTask: cron.ScheduledTask | null = null;

/**
 * Start the upkeep cron job
 */
export function startUpkeepTask(client: Client): void {
  if (upkeepTask) {
    logger.warn('Upkeep task is already running');
    return;
  }

  // Schedule task to run at midnight UTC (0 0 * * *)
  upkeepTask = cron.schedule('0 0 * * *', async () => {
    try {
      logger.info('Running daily faction upkeep task...');
      await upkeepManager.processAllUpkeep(client);
      logger.info('Daily faction upkeep task completed');
    } catch (error) {
      logger.error('Error in upkeep cron task:', error);
    }
  }, {
    scheduled: true,
    timezone: 'UTC',
  });

  logger.info('Faction upkeep task scheduled (runs daily at midnight UTC)');
}

/**
 * Stop the upkeep cron job
 */
export function stopUpkeepTask(): void {
  if (upkeepTask) {
    upkeepTask.stop();
    upkeepTask = null;
    logger.info('Faction upkeep task stopped');
  }
}

/**
 * Check if upkeep task is running
 */
export function isUpkeepTaskRunning(): boolean {
  return upkeepTask !== null;
}
