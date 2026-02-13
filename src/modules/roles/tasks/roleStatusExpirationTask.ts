import logger from '../../../core/logger';
import { configManager } from '../../../core/configManager';
import { database } from '../../../database/client';
import { roleStatusManager } from '../services/roleStatusManager';
import { roleSystemGuard } from '../utils/roleSystemGuard';

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
    // Check if role system is enabled - we need to check per guild
    // For now, we'll check if the config manager has a loaded config and use that guild
    if (configManager.hasConfig()) {
      const config = configManager.getConfig();
      const guildId = config.guildId;
      
      if (!roleSystemGuard.isEnabledSync(guildId)) {
        logger.debug(`Role status expiration: Skipping because role system is disabled for guild ${guildId}`);
        return;
      }
    } else {
      logger.debug('Role status expiration: No config loaded, skipping role system check');
    }

    // If tournaments are configured to pause roles during active tournament, skip
    if (configManager.hasConfig()) {
      const config = configManager.getConfig();
      if (config.tournaments?.pauseRolesDuringTournament) {
        const guildId = config.guildId;
        const activeTournament = await database.tournaments.findOne({
          guildId,
          status: 'active',
        });
        if (activeTournament) {
          logger.info(
            `Role status expiration: Skipping run because an active tournament (${activeTournament.name}) is ongoing and pauseRolesDuringTournament=true`
          );
          return;
        }
      }
    }

    const expiredCount = await roleStatusManager.checkExpiredStatuses();
    if (expiredCount > 0) {
      logger.info(`Cleaned up ${expiredCount} expired role statuses`);
    }
  } catch (error) {
    logger.error('Error checking expired statuses:', error);
  }
}

