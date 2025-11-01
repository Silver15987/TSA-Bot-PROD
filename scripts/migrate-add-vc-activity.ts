#!/usr/bin/env tsx

/**
 * Migration: Add VC Activity Collection and Daily Stats Tracking
 *
 * This migration:
 * 1. Creates the vcActivity collection
 * 2. Creates necessary indexes (user + date, faction + date, TTL)
 * 3. Ensures all users have reset timestamp fields (lastDailyReset, etc.)
 * 4. Initializes reset timestamps to current date for existing users
 *
 * Usage: npm run migrate:vc-activity
 */

import { database } from '../src/database/client';
import logger from '../src/core/logger';

async function migrate() {
  try {
    logger.info('Starting VC Activity migration...');
    logger.info('This will add session-level tracking and daily/weekly/monthly resets');

    // Connect to database
    await database.connect();

    // 1. Create collection (MongoDB will auto-create, but we can verify it exists)
    logger.info('Step 1: Verifying vcActivity collection...');
    const collections = await database.getDb().listCollections({ name: 'vcActivity' }).toArray();

    if (collections.length === 0) {
      await database.getDb().createCollection('vcActivity');
      logger.info('✓ Created vcActivity collection');
    } else {
      logger.info('✓ vcActivity collection already exists');
    }

    // 2. Create indexes
    logger.info('Step 2: Creating indexes...');

    await database.vcActivity.createIndex({ userId: 1, date: -1 });
    logger.info('✓ Created index: userId + date (for user queries)');

    await database.vcActivity.createIndex({ factionId: 1, date: -1 });
    logger.info('✓ Created index: factionId + date (for faction queries)');

    await database.vcActivity.createIndex({ guildId: 1, date: -1 });
    logger.info('✓ Created index: guildId + date (for guild-wide queries)');

    await database.vcActivity.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 7776000 } // 90 days TTL
    );
    logger.info('✓ Created TTL index: createdAt (90 days auto-cleanup)');

    // 3. Ensure all users have reset timestamp fields
    logger.info('Step 3: Initializing reset timestamps for existing users...');

    const now = new Date();
    const result = await database.users.updateMany(
      {
        $or: [
          { lastDailyReset: { $exists: false } },
          { lastWeeklyReset: { $exists: false } },
          { lastMonthlyReset: { $exists: false } },
        ],
      },
      {
        $set: {
          lastDailyReset: now,
          lastWeeklyReset: now,
          lastMonthlyReset: now,
        },
      }
    );

    logger.info(`✓ Updated ${result.modifiedCount} users with reset timestamp fields`);

    // 4. Summary
    logger.info('');
    logger.info('✅ Migration complete!');
    logger.info('');
    logger.info('What was added:');
    logger.info('  - vcActivity collection for session-level tracking');
    logger.info('  - Indexes for efficient queries (user, faction, guild)');
    logger.info('  - TTL index for automatic 90-day cleanup');
    logger.info('  - Reset timestamp fields for all users');
    logger.info('');
    logger.info('How it works:');
    logger.info('  - Each VC session is now saved with start/end times, channel, faction info');
    logger.info('  - Daily/weekly/monthly counters reset automatically on user activity (lazy reset)');
    logger.info('  - Old session records auto-delete after 90 days');
    logger.info('  - All existing functionality continues to work normally');
    logger.info('');
    logger.info('Next steps:');
    logger.info('  - Deploy the updated bot code');
    logger.info('  - Session tracking will start immediately');
    logger.info('  - Historical data begins accumulating from now onwards');

  } catch (error) {
    logger.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await database.disconnect();
  }
}

// Main execution
async function main() {
  try {
    await migrate();
    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the script
main();
