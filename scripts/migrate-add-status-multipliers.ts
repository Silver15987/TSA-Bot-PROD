#!/usr/bin/env tsx

/**
 * Migration: Add Status and Multiplier Fields
 *
 * This migration:
 * 1. Adds statuses, items, and multiplierEnabled fields to all existing users
 * 2. Adds coinMultiplier field to all existing factions
 * 3. Initializes all fields with safe defaults (empty arrays, enabled=true, multiplier=1.0)
 *
 * Note: These fields are optional in the schema, so existing code will work without them.
 * This migration ensures data consistency and optimal performance.
 *
 * Usage: npm run migrate:status-multipliers
 * or: tsx scripts/migrate-add-status-multipliers.ts
 */

import { database } from '../src/database/client';
import logger from '../src/core/logger';

async function migrate() {
  try {
    logger.info('Starting Status and Multiplier migration...');
    logger.info('This will add status/multiplier fields to all users and factions');

    // Connect to database
    await database.connect();

    // 1. Update all users missing status fields
    logger.info('Step 1: Updating users with status and multiplier fields...');

    const userUpdateResult = await database.users.updateMany(
      {
        $or: [
          { statuses: { $exists: false } },
          { items: { $exists: false } },
          { multiplierEnabled: { $exists: false } },
        ],
      },
      {
        $set: {
          statuses: [],
          items: [],
          multiplierEnabled: true,
          updatedAt: new Date(),
        },
      }
    );

    logger.info(`✓ Updated ${userUpdateResult.modifiedCount} users with status/multiplier fields`);

    // 2. Update all factions missing coinMultiplier field
    logger.info('Step 2: Updating factions with coinMultiplier field...');

    const factionUpdateResult = await database.factions.updateMany(
      {
        coinMultiplier: { $exists: false },
      },
      {
        $set: {
          coinMultiplier: 1.0,
          updatedAt: new Date(),
        },
      }
    );

    logger.info(`✓ Updated ${factionUpdateResult.modifiedCount} factions with coinMultiplier field`);

    // 3. Summary
    logger.info('');
    logger.info('✅ Migration complete!');
    logger.info('');
    logger.info('What was added:');
    logger.info('  - statuses: [] (empty array) to all users');
    logger.info('  - items: [] (empty array) to all users');
    logger.info('  - multiplierEnabled: true to all users');
    logger.info('  - coinMultiplier: 1.0 to all factions');
    logger.info('');
    logger.info('Impact:');
    logger.info('  - Existing users and factions now have consistent data structure');
    logger.info('  - All multipliers default to 1.0 (no effect until changed)');
    logger.info('  - Multipliers are enabled by default for all users');
    logger.info('  - No breaking changes - all fields are optional');
    logger.info('');
    logger.info('Next steps:');
    logger.info('  - Deploy the updated bot code');
    logger.info('  - Multipliers will start working immediately');
    logger.info('  - Use /multiplier-admin to manage user multipliers');
    logger.info('  - Faction multipliers can be set via admin commands (future feature)');

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
    process.exit(0);
  } catch (error) {
    logger.error('Migration script failed:', error);
    process.exit(1);
  }
}

main();


