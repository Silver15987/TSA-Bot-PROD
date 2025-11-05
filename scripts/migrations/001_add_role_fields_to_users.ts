#!/usr/bin/env tsx

/**
 * Migration 001: Add Role Fields to Users
 *
 * This migration:
 * 1. Adds role field (null) to all existing UserDocuments
 * 2. Adds roleProgress field (empty array) to all existing UserDocuments
 * 3. Adds roleCooldowns field (empty array) to all existing UserDocuments
 *
 * Note: These fields are optional in the schema, so existing code will work without them.
 * This migration ensures data consistency and optimal performance.
 *
 * Usage: tsx scripts/migrations/001_add_role_fields_to_users.ts
 */

import { database } from '../../src/database/client';
import logger from '../../src/core/logger';

export async function up(): Promise<void> {
  try {
    logger.info('Starting Migration 001: Add Role Fields to Users...');
    logger.info('This will add role fields to all users');

    // Connect to database
    await database.connect();

    // Update all users missing role fields
    logger.info('Updating users with role fields...');

    const userUpdateResult = await database.users.updateMany(
      {
        $or: [
          { role: { $exists: false } },
          { roleProgress: { $exists: false } },
          { roleCooldowns: { $exists: false } },
        ],
      },
      {
        $set: {
          role: null,
          roleProgress: [],
          roleCooldowns: [],
          updatedAt: new Date(),
        },
      }
    );

    logger.info(`✓ Updated ${userUpdateResult.modifiedCount} users with role fields`);

    logger.info('');
    logger.info('✅ Migration 001 complete!');
    logger.info('');
    logger.info('What was added:');
    logger.info('  - role: null to all users');
    logger.info('  - roleProgress: [] (empty array) to all users');
    logger.info('  - roleCooldowns: [] (empty array) to all users');
    logger.info('');
    logger.info('Impact:');
    logger.info('  - Existing users now have consistent data structure');
    logger.info('  - All users start with no role (role: null)');
    logger.info('  - No breaking changes - all fields are optional');

  } catch (error) {
    logger.error('❌ Migration 001 failed:', error);
    throw error;
  } finally {
    await database.disconnect();
  }
}

export async function down(): Promise<void> {
  try {
    logger.info('Rolling back Migration 001: Remove Role Fields from Users...');

    await database.connect();

    // Remove role fields (set to undefined to effectively remove them)
    const userUpdateResult = await database.users.updateMany(
      {},
      {
        $unset: {
          role: '',
          roleProgress: '',
          roleCooldowns: '',
        },
        $set: {
          updatedAt: new Date(),
        },
      }
    );

    logger.info(`✓ Removed role fields from ${userUpdateResult.modifiedCount} users`);
    logger.info('✅ Rollback complete!');

  } catch (error) {
    logger.error('❌ Rollback failed:', error);
    throw error;
  } finally {
    await database.disconnect();
  }
}

// Main execution (for direct script running)
async function main() {
  const command = process.argv[2];
  
  try {
    if (command === 'down') {
      await down();
    } else {
      await up();
    }
    process.exit(0);
  } catch (error) {
    logger.error('Migration script failed:', error);
    process.exit(1);
  }
}

// Only run if executed directly
if (require.main === module) {
  main();
}

