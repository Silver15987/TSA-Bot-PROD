#!/usr/bin/env tsx

/**
 * Script to toggle quest system on/off
 * Usage: npm run toggle-quests <guildId> <enabled>
 * 
 * Examples:
 *   npm run toggle-quests 123456789 false  (disable quests)
 *   npm run toggle-quests 123456789 true   (enable quests)
 * 
 * To find your guild ID:
 * 1. Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)
 * 2. Right-click on your server name and select "Copy Server ID"
 */

import { database } from '../src/database/client';
import { configManager } from '../src/core/configManager';
import logger from '../src/core/logger';

async function toggleQuests(guildId: string, enabled: boolean): Promise<void> {
  try {
    const status = enabled ? 'ENABLED' : 'DISABLED';
    logger.info(`Setting quest system to ${status} for guild ${guildId}`);

    // Connect to database
    await database.connect();

    // Update the configuration in the database
    const result = await database.serverConfigs.updateOne(
      { guildId },
      {
        $set: {
          'quests.enabled': enabled,
          updatedAt: new Date(),
          updatedBy: 'script',
        },
        $inc: { version: 1 },
      },
      { upsert: true }
    );

    if (result.acknowledged) {
      logger.info(`✅ Successfully ${status.toLowerCase()} quest system for guild ${guildId}`);
      
      // Reload the configuration
      await configManager.reloadConfig(guildId);
      
      // Verify the change
      const config = configManager.getConfig(guildId);
      const questsEnabled = config.quests?.enabled !== false;
      logger.info(`✅ Verified: Quest system is now ${questsEnabled ? 'ENABLED' : 'DISABLED'}`);
      
      if (!enabled) {
        logger.info('');
        logger.info('⚠️  IMPORTANT: You must restart the bot for quest system changes to take full effect.');
        logger.info('   The scheduler will not start until restart, but quest tracking is already disabled.');
      }
    } else {
      logger.error('❌ Failed to update quest system status');
    }

  } catch (error) {
    logger.error('Error toggling quest system:', error);
    throw error;
  } finally {
    await database.disconnect();
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error('Usage: npm run toggle-quests <guildId> <enabled>');
    console.error('');
    console.error('Examples:');
    console.error('  npm run toggle-quests 123456789 false  (disable quests)');
    console.error('  npm run toggle-quests 123456789 true   (enable quests)');
    console.error('');
    console.error('To find your guild ID:');
    console.error('  1. Enable Developer Mode in Discord');
    console.error('  2. Right-click on your server name and select "Copy Server ID"');
    process.exit(1);
  }

  const [guildId, enabledStr] = args;
  const enabled = enabledStr.toLowerCase() === 'true';

  if (enabledStr.toLowerCase() !== 'true' && enabledStr.toLowerCase() !== 'false') {
    console.error('Error: enabled must be "true" or "false"');
    process.exit(1);
  }

  await toggleQuests(guildId, enabled);
}

// Run the script
main()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
