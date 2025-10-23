/**
 * Migration Script: Add Quest Configuration to Existing Server Configs
 *
 * This script adds the quest configuration to all existing server configs
 * that don't have it yet.
 */

import { database } from '../src/database/client';
import logger from '../src/core/logger';

async function addQuestConfig() {
  try {
    logger.info('Connecting to database...');
    await database.connect();

    logger.info('Finding server configs without quest configuration...');

    // Find all configs that don't have the quests field
    const configs = await database.serverConfigs.find({
      quests: { $exists: false }
    }).toArray();

    logger.info(`Found ${configs.length} server config(s) to update`);

    if (configs.length === 0) {
      logger.info('All server configs already have quest configuration');
      await database.disconnect();
      return;
    }

    // Default quest configuration
    const defaultQuestConfig = {
      enabled: true,
      acceptanceWindowHours: 3,
      cooldownHours: 3,
      autoAssignEnabled: true,
      autoAssignIntervalHours: 6,
      difficultyScaling: {
        easy: {
          maxMembers: 5,
          vcTimeMultiplier: 1.0,
          coinsMultiplier: 1.0,
        },
        medium: {
          maxMembers: 10,
          vcTimeMultiplier: 1.5,
          coinsMultiplier: 1.5,
        },
        hard: {
          maxMembers: 999,
          vcTimeMultiplier: 2.0,
          coinsMultiplier: 2.0,
        },
      },
    };

    // Update each config
    let updated = 0;
    for (const config of configs) {
      const result = await database.serverConfigs.updateOne(
        { guildId: config.guildId },
        {
          $set: {
            quests: defaultQuestConfig,
            updatedAt: new Date(),
            version: (config.version || 1) + 1,
          },
        }
      );

      if (result.modifiedCount > 0) {
        updated++;
        logger.info(`✅ Updated config for guild ${config.guildId}`);
      }
    }

    logger.info(`✅ Migration complete! Updated ${updated}/${configs.length} server configs`);
    logger.info('Quest system is now configured for all servers');

    await database.disconnect();
  } catch (error) {
    logger.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
addQuestConfig();
