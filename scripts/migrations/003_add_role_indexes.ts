#!/usr/bin/env tsx

/**
 * Migration 003: Add Role Indexes
 *
 * This migration:
 * 1. Adds indexes to users collection for role queries
 * 2. Ensures all role-related indexes are created
 *
 * Usage: tsx scripts/migrations/003_add_role_indexes.ts
 */

import { database } from '../../src/database/client';
import logger from '../../src/core/logger';

export async function up(): Promise<void> {
  try {
    logger.info('Starting Migration 003: Add Role Indexes...');
    logger.info('This will add indexes for role queries');

    // Connect to database
    await database.connect();

    logger.info('Creating indexes on users collection for role queries...');

    // Add indexes (will be idempotent - won't fail if already exists)
    try {
      await database.users.createIndex({ role: 1 }, { name: 'role_idx' });
      logger.info('✓ Created index on users (role)');
    } catch (error: any) {
      if (error.code === 85) {
        // Index already exists
        logger.info('✓ Index on users (role) already exists');
      } else {
        throw error;
      }
    }

    try {
      await database.users.createIndex(
        { guildId: 1, role: 1 },
        { name: 'guildId_role_idx' }
      );
      logger.info('✓ Created index on users (guildId, role)');
    } catch (error: any) {
      if (error.code === 85) {
        logger.info('✓ Index on users (guildId, role) already exists');
      } else {
        throw error;
      }
    }

    logger.info('');
    logger.info('✅ Migration 003 complete!');
    logger.info('');
    logger.info('What was created:');
    logger.info('  - Index on users (role)');
    logger.info('  - Index on users (guildId, role)');
    logger.info('');
    logger.info('Impact:');
    logger.info('  - Faster queries for users by role');
    logger.info('  - Faster queries for users by guild and role');

  } catch (error) {
    logger.error('❌ Migration 003 failed:', error);
    throw error;
  } finally {
    await database.disconnect();
  }
}

export async function down(): Promise<void> {
  try {
    logger.info('Rolling back Migration 003: Remove Role Indexes...');

    await database.connect();

    logger.info('Dropping role indexes from users collection...');

    try {
      await database.users.dropIndex('role_idx');
      logger.info('✓ Dropped index role_idx');
    } catch (error: any) {
      if (error.code === 27) {
        logger.info('✓ Index role_idx does not exist');
      } else {
        throw error;
      }
    }

    try {
      await database.users.dropIndex('guildId_role_idx');
      logger.info('✓ Dropped index guildId_role_idx');
    } catch (error: any) {
      if (error.code === 27) {
        logger.info('✓ Index guildId_role_idx does not exist');
      } else {
        throw error;
      }
    }

    logger.info('✅ Rollback complete!');

  } catch (error) {
    logger.error('❌ Rollback failed:', error);
    throw error;
  } finally {
    await database.disconnect();
  }
}

// Main execution
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

if (require.main === module) {
  main();
}

