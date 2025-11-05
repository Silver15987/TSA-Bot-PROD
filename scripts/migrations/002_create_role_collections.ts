#!/usr/bin/env tsx

/**
 * Migration 002: Create Role Collections
 *
 * This migration:
 * 1. Creates roleUnlockConditions collection (will be created automatically on first insert)
 * 2. Creates roleActionLogs collection
 * 3. Creates roleStatuses collection
 * 4. Creates indexes for each collection
 *
 * Note: MongoDB creates collections automatically on first insert, but we'll ensure
 * they exist and have proper indexes.
 *
 * Usage: tsx scripts/migrations/002_create_role_collections.ts
 */

import { database } from '../../src/database/client';
import logger from '../../src/core/logger';

export async function up(): Promise<void> {
  try {
    logger.info('Starting Migration 002: Create Role Collections...');
    logger.info('This will create role collections and indexes');

    // Connect to database
    await database.connect();

    const db = database.getDb();

    // Collections will be created automatically on first insert
    // But we'll create them explicitly and add indexes

    logger.info('Creating roleUnlockConditions collection...');
    try {
      await db.createCollection('roleUnlockConditions');
      logger.info('✓ Created roleUnlockConditions collection');
    } catch (error: any) {
      if (error.code === 48) {
        // Collection already exists
        logger.info('✓ roleUnlockConditions collection already exists');
      } else {
        throw error;
      }
    }

    logger.info('Creating roleActionLogs collection...');
    try {
      await db.createCollection('roleActionLogs');
      logger.info('✓ Created roleActionLogs collection');
    } catch (error: any) {
      if (error.code === 48) {
        logger.info('✓ roleActionLogs collection already exists');
      } else {
        throw error;
      }
    }

    logger.info('Creating roleStatuses collection...');
    try {
      await db.createCollection('roleStatuses');
      logger.info('✓ Created roleStatuses collection');
    } catch (error: any) {
      if (error.code === 48) {
        logger.info('✓ roleStatuses collection already exists');
      } else {
        throw error;
      }
    }

    // Create indexes
    logger.info('Creating indexes...');

    await database.roleUnlockConditions.createIndex(
      { guildId: 1, roleType: 1 },
      { unique: true, name: 'guildId_roleType_unique' }
    );
    logger.info('✓ Created index on roleUnlockConditions (guildId, roleType)');

    await database.roleActionLogs.createIndex(
      { userId: 1, createdAt: -1 },
      { name: 'userId_createdAt_idx' }
    );
    await database.roleActionLogs.createIndex(
      { guildId: 1, roleType: 1 },
      { name: 'guildId_roleType_idx' }
    );
    await database.roleActionLogs.createIndex(
      { targetUserId: 1, createdAt: -1 },
      { name: 'targetUserId_createdAt_idx' }
    );
    await database.roleActionLogs.createIndex(
      { targetFactionId: 1, createdAt: -1 },
      { name: 'targetFactionId_createdAt_idx' }
    );
    logger.info('✓ Created indexes on roleActionLogs');

    await database.roleStatuses.createIndex(
      { userId: 1, expiresAt: 1 },
      { name: 'userId_expiresAt_idx' }
    );
    await database.roleStatuses.createIndex(
      { targetUserId: 1, expiresAt: 1 },
      { name: 'targetUserId_expiresAt_idx' }
    );
    await database.roleStatuses.createIndex(
      { targetFactionId: 1, expiresAt: 1 },
      { name: 'targetFactionId_expiresAt_idx' }
    );
    await database.roleStatuses.createIndex(
      { expiresAt: 1 },
      { name: 'expiresAt_idx' }
    );
    logger.info('✓ Created indexes on roleStatuses');

    logger.info('');
    logger.info('✅ Migration 002 complete!');
    logger.info('');
    logger.info('What was created:');
    logger.info('  - roleUnlockConditions collection with indexes');
    logger.info('  - roleActionLogs collection with indexes');
    logger.info('  - roleStatuses collection with indexes');

  } catch (error) {
    logger.error('❌ Migration 002 failed:', error);
    throw error;
  } finally {
    await database.disconnect();
  }
}

export async function down(): Promise<void> {
  try {
    logger.info('Rolling back Migration 002: Drop Role Collections...');

    await database.connect();

    const db = database.getDb();

    logger.info('Dropping role collections...');
    
    try {
      await db.dropCollection('roleUnlockConditions');
      logger.info('✓ Dropped roleUnlockConditions collection');
    } catch (error: any) {
      if (error.code === 26) {
        logger.info('✓ roleUnlockConditions collection does not exist');
      } else {
        throw error;
      }
    }

    try {
      await db.dropCollection('roleActionLogs');
      logger.info('✓ Dropped roleActionLogs collection');
    } catch (error: any) {
      if (error.code === 26) {
        logger.info('✓ roleActionLogs collection does not exist');
      } else {
        throw error;
      }
    }

    try {
      await db.dropCollection('roleStatuses');
      logger.info('✓ Dropped roleStatuses collection');
    } catch (error: any) {
      if (error.code === 26) {
        logger.info('✓ roleStatuses collection does not exist');
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

