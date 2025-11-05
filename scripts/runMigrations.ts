#!/usr/bin/env tsx

/**
 * Migration Runner
 * 
 * Runs all pending migrations in order.
 * Tracks which migrations have been run in a migrations collection.
 * 
 * Usage:
 *   tsx scripts/runMigrations.ts        # Run all pending migrations
 *   tsx scripts/runMigrations.ts 001   # Run specific migration
 *   tsx scripts/runMigrations.ts down  # Rollback last migration
 */

import { database } from '../src/database/client';
import logger from '../src/core/logger';

interface MigrationRecord {
  id: string;
  name: string;
  executedAt: Date;
  executedBy: string;
}

const migrations = [
  {
    id: '001',
    name: '001_add_role_fields_to_users',
    file: './migrations/001_add_role_fields_to_users',
  },
  {
    id: '002',
    name: '002_create_role_collections',
    file: './migrations/002_create_role_collections',
  },
  {
    id: '003',
    name: '003_add_role_indexes',
    file: './migrations/003_add_role_indexes',
  },
];

async function getExecutedMigrations(): Promise<Set<string>> {
  try {
    await database.connect();
    const executed = await database.getCollection<MigrationRecord>('migrations')
      .find({})
      .toArray();
    return new Set(executed.map(m => m.id));
  } catch (error) {
    // Collection doesn't exist yet, return empty set
    return new Set();
  } finally {
    await database.disconnect();
  }
}

async function markMigrationExecuted(migrationId: string, migrationName: string): Promise<void> {
  await database.connect();
  try {
    await database.getCollection<MigrationRecord>('migrations').insertOne({
      id: migrationId,
      name: migrationName,
      executedAt: new Date(),
      executedBy: process.env.USER || 'system',
    });
  } finally {
    await database.disconnect();
  }
}

async function removeMigrationRecord(migrationId: string): Promise<void> {
  await database.connect();
  try {
    await database.getCollection<MigrationRecord>('migrations').deleteOne({ id: migrationId });
  } finally {
    await database.disconnect();
  }
}

async function runMigration(migrationId: string, direction: 'up' | 'down' = 'up'): Promise<void> {
  const migration = migrations.find(m => m.id === migrationId);
  if (!migration) {
    throw new Error(`Migration ${migrationId} not found`);
  }

  logger.info(`Running migration ${migration.name} (${direction})...`);

  try {
    // Dynamically import the migration module
    const migrationModule = await import(migration.file);
    
    if (direction === 'down') {
      if (migrationModule.down) {
        await migrationModule.down();
        await removeMigrationRecord(migrationId);
        logger.info(`✓ Migration ${migration.name} rolled back`);
      } else {
        logger.warn(`Migration ${migration.name} does not support rollback`);
      }
    } else {
      await migrationModule.up();
      await markMigrationExecuted(migrationId, migration.name);
      logger.info(`✓ Migration ${migration.name} executed successfully`);
    }
  } catch (error) {
    logger.error(`❌ Migration ${migration.name} failed:`, error);
    throw error;
  }
}

async function runAllPendingMigrations(): Promise<void> {
  logger.info('Checking for pending migrations...');
  
  const executed = await getExecutedMigrations();
  const pending = migrations.filter(m => !executed.has(m.id));

  if (pending.length === 0) {
    logger.info('✓ No pending migrations');
    return;
  }

  logger.info(`Found ${pending.length} pending migration(s)`);

  for (const migration of pending) {
    await runMigration(migration.id, 'up');
  }

  logger.info('');
  logger.info('✅ All migrations completed!');
}

async function main() {
  const command = process.argv[2];

  try {
    if (command === 'down') {
      // Rollback last migration
      const executed = await getExecutedMigrations();
      const executedMigrations = migrations.filter(m => executed.has(m.id));
      if (executedMigrations.length === 0) {
        logger.info('No migrations to rollback');
        return;
      }
      const lastMigration = executedMigrations[executedMigrations.length - 1];
      await runMigration(lastMigration.id, 'down');
    } else if (command && /^\d{3}$/.test(command)) {
      // Run specific migration
      await runMigration(command, 'up');
    } else {
      // Run all pending migrations
      await runAllPendingMigrations();
    }
    
    process.exit(0);
  } catch (error) {
    logger.error('Migration runner failed:', error);
    process.exit(1);
  }
}

main();

