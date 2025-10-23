#!/usr/bin/env tsx

/**
 * Script to set faction category ID in the database
 * Usage: npm run set-faction-category <guildId> <categoryId>
 * 
 * To find your guild ID:
 * 1. Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)
 * 2. Right-click on your server name and select "Copy Server ID"
 */

import { database } from '../src/database/client';
import { configManager } from '../src/core/configManager';
import logger from '../src/core/logger';

async function setFactionCategory(guildId: string, categoryId: string): Promise<void> {
  try {
    logger.info(`Setting faction category ID to ${categoryId} for guild ${guildId}`);

    // Connect to database
    await database.connect();

    // Update the configuration in the database
    const result = await database.serverConfigs.updateOne(
      { guildId },
      {
        $set: {
          'factions.factionCategoryId': categoryId,
          updatedAt: new Date(),
          updatedBy: 'script',
        },
        $inc: { version: 1 },
      },
      { upsert: true }
    );

    if (result.acknowledged) {
      logger.info(`✅ Successfully updated faction category ID for guild ${guildId}`);
      
      // Reload the configuration
      await configManager.reloadConfig(guildId);
      
      // Verify the change
      const config = configManager.getConfig(guildId);
      logger.info(`✅ Verified: Faction category ID is now ${config.factions.factionCategoryId}`);
    } else {
      logger.error('❌ Failed to update faction category ID');
    }

  } catch (error) {
    logger.error('Error setting faction category:', error);
    throw error;
  } finally {
    await database.disconnect();
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length !== 2) {
    console.log('Usage: npm run set-faction-category <guildId> <categoryId>');
    console.log('Example: npm run set-faction-category 123456789012345678 1429838249718841394');
    console.log('');
    console.log('To find your guild ID:');
    console.log('1. Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)');
    console.log('2. Right-click on your server name and select "Copy Server ID"');
    process.exit(1);
  }

  const [guildId, categoryId] = args;

  // Validate guild ID format (should be a Discord snowflake)
  if (!/^\d{17,19}$/.test(guildId)) {
    console.error('❌ Invalid guild ID format. Guild ID should be 17-19 digits.');
    process.exit(1);
  }

  // Validate category ID format (should be a Discord snowflake)
  if (!/^\d{17,19}$/.test(categoryId)) {
    console.error('❌ Invalid category ID format. Category ID should be 17-19 digits.');
    process.exit(1);
  }

  try {
    await setFactionCategory(guildId, categoryId);
    console.log('✅ Faction category ID set successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to set faction category ID:', error);
    process.exit(1);
  }
}

// Run the script
main();