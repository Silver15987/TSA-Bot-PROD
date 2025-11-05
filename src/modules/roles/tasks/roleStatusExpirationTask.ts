import logger from '../../../core/logger';
import { roleStatusManager } from '../services/roleStatusManager';

let statusExpirationInterval: NodeJS.Timeout | null = null;

/**
 * Start the role status expiration task
 * Checks and removes expired role statuses every 5 minutes
 */
export function startRoleStatusExpirationTask(): void {
  if (statusExpirationInterval) {
    logger.warn('Role status expiration task already running');
    return;
  }

  logger.info('Starting role status expiration task...');

  // Run immediately on start
  checkExpiredStatuses();

  // Run every 5 minutes
  statusExpirationInterval = setInterval(() => {
    checkExpiredStatuses();
  }, 5 * 60 * 1000); // 5 minutes

  logger.info('Role status expiration task started (runs every 5 minutes)');
}

/**
 * Stop the role status expiration task
 */
export function stopRoleStatusExpirationTask(): void {
  if (statusExpirationInterval) {
    clearInterval(statusExpirationInterval);
    statusExpirationInterval = null;
    logger.info('Role status expiration task stopped');
  }
}

/**
 * Check and remove expired statuses
 */
async function checkExpiredStatuses(): Promise<void> {
  try {
    const expiredCount = await roleStatusManager.checkExpiredStatuses();
    if (expiredCount > 0) {
      logger.info(`Cleaned up ${expiredCount} expired role statuses`);
    }
  } catch (error) {
    logger.error('Error checking expired statuses:', error);
  }
}

