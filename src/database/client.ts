import { MongoClient, Db, Collection, Document } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { config } from '../core/config';
import logger from '../core/logger';
import {
  UserDocument,
  FactionDocument,
  QuestDocument,
  QuestCooldownDocument,
  WarDocument,
  TransactionDocument,
  ServerConfigDocument,
  ReactionRoleDocument,
  VCActivityDocument,
  RoleUnlockConditionDocument,
  RoleActionLogDocument,
  RoleStatusDocument,
  TournamentDocument,
  TournamentMatchDocument,
} from '../types/database';

/**
 * MongoDB Client Manager
 */
class DatabaseClient {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private isConnected = false;

  /**
   * Connect to MongoDB
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      logger.warn('Database already connected');
      return;
    }

    try {
      logger.info('Connecting to Cosmos DB...');
      this.client = new MongoClient(config.database.uri, {
        retryWrites: false,
        retryReads: true,
        maxPoolSize: 10,
        minPoolSize: 2,
      });

      await this.client.connect();
      this.db = this.client.db(config.database.name);
      this.isConnected = true;

      logger.info('Successfully connected to Cosmos DB');

      // Create indexes
      await this.createIndexes();
    } catch (error) {
      logger.error('Failed to connect to Cosmos DB:', error);
      throw error;
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected || !this.client) {
      return;
    }

    try {
      await this.client.close();
      this.isConnected = false;
      logger.info('Disconnected from Cosmos DB');
    } catch (error) {
      logger.error('Error disconnecting from Cosmos DB:', error);
      throw error;
    }
  }

  /**
   * Get database instance
   */
  getDb(): Db {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  /**
   * Get collection with type safety
   */
  getCollection<T extends Document>(name: string): Collection<T> {
    const baseCollection = this.getDb().collection<T>(name);

    if (!DB_CALL_METRICS_ENABLED) {
      return baseCollection;
    }

    const handler: ProxyHandler<Collection<T>> = {
      get(target, prop, receiver) {
        const value = (target as any)[prop];

        if (typeof value !== 'function') {
          return Reflect.get(target, prop, receiver);
        }

        const opName = String(prop);

        if (!INSTRUMENTED_OPS.has(opName)) {
          return value.bind(target);
        }

        return (...args: any[]) => {
          recordDbCall(opName, name);
          return (value as Function).apply(target, args);
        };
      },
    };

    return new Proxy(baseCollection, handler);
  }

  /**
   * Collection accessors
   */
  get users(): Collection<UserDocument> {
    return this.getCollection<UserDocument>('users');
  }

  get factions(): Collection<FactionDocument> {
    return this.getCollection<FactionDocument>('factions');
  }

  get quests(): Collection<QuestDocument> {
    return this.getCollection<QuestDocument>('quests');
  }

  get questCooldowns(): Collection<QuestCooldownDocument> {
    return this.getCollection<QuestCooldownDocument>('questCooldowns');
  }

  get wars(): Collection<WarDocument> {
    return this.getCollection<WarDocument>('wars');
  }

  get transactions(): Collection<TransactionDocument> {
    return this.getCollection<TransactionDocument>('transactions');
  }

  get serverConfigs(): Collection<ServerConfigDocument> {
    return this.getCollection<ServerConfigDocument>('serverConfigs');
  }

  get reactionRoles(): Collection<ReactionRoleDocument> {
    return this.getCollection<ReactionRoleDocument>('reactionRoles');
  }

  get vcActivity(): Collection<VCActivityDocument> {
    return this.getCollection<VCActivityDocument>('vcActivity');
  }

  get roleUnlockConditions(): Collection<RoleUnlockConditionDocument> {
    return this.getCollection<RoleUnlockConditionDocument>('roleUnlockConditions');
  }

  get roleActionLogs(): Collection<RoleActionLogDocument> {
    return this.getCollection<RoleActionLogDocument>('roleActionLogs');
  }

  get roleStatuses(): Collection<RoleStatusDocument> {
    return this.getCollection<RoleStatusDocument>('roleStatuses');
  }

  get tournaments(): Collection<TournamentDocument> {
    return this.getCollection<TournamentDocument>('tournaments');
  }

  get tournamentMatches(): Collection<TournamentMatchDocument> {
    return this.getCollection<TournamentMatchDocument>('tournamentMatches');
  }

  /**
   * Create database indexes for performance
   */
  private async createIndexes(): Promise<void> {
    logger.info('Creating database indexes...');

    try {
      // Users indexes
      await this.users.createIndex({ id: 1 }, { unique: true });
      await this.users.createIndex({ guildId: 1 });
      await this.users.createIndex({ currentFaction: 1 });
      await this.users.createIndex({ lastActiveDate: 1 });
      await this.users.createIndex({ totalCoinsEarned: -1 });
      await this.users.createIndex({ dailyCoinsEarned: -1 });

      // Factions indexes
      await this.factions.createIndex({ id: 1 }, { unique: true });
      await this.factions.createIndex({ guildId: 1 });
      await this.factions.createIndex({ name: 1, guildId: 1 }, { unique: true });
      await this.factions.createIndex({ treasury: -1 });
      await this.factions.createIndex({ nextUpkeepDate: 1 });

      // Quests indexes
      await this.quests.createIndex({ factionId: 1, status: 1 });
      await this.quests.createIndex({ status: 1, questDeadline: 1 });
      await this.quests.createIndex({ guildId: 1, isTemplate: 1 });
      await this.quests.createIndex({ guildId: 1, status: 1 });
      await this.quests.createIndex({ factionId: 1, completedAt: -1 }); // For quest history sorting

      // Quest Cooldowns indexes
      await this.questCooldowns.createIndex({ factionId: 1 }, { unique: true });
      await this.questCooldowns.createIndex({ cooldownEndsAt: 1 });

      // Wars indexes
      await this.wars.createIndex({ guildId: 1, status: 1 });
      await this.wars.createIndex({ status: 1, endsAt: 1 });

      // Transactions indexes
      await this.transactions.createIndex({ userId: 1, createdAt: -1 });
      await this.transactions.createIndex({ type: 1 });
      await this.transactions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 31536000 }); // TTL: 1 year

      // ServerConfigs indexes
      await this.serverConfigs.createIndex({ guildId: 1 }, { unique: true });

      // ReactionRoles indexes
      await this.reactionRoles.createIndex({ messageId: 1, emoji: 1 }, { unique: true });
      await this.reactionRoles.createIndex({ guildId: 1 });

      // VCActivity indexes
      await this.vcActivity.createIndex({ userId: 1, date: -1 }); // Query by user + date range
      await this.vcActivity.createIndex({ factionId: 1, date: -1 }); // Query by faction
      await this.vcActivity.createIndex({ guildId: 1, date: -1 }); // Query by guild
      await this.vcActivity.createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: 7776000 } // TTL: 90 days
      );

      // Role System indexes
      await this.users.createIndex({ role: 1 }); // Query by role
      await this.users.createIndex({ guildId: 1, role: 1 }); // Query by guild and role
      
      await this.roleUnlockConditions.createIndex({ guildId: 1, roleType: 1 }, { unique: true });
      
      await this.roleActionLogs.createIndex({ userId: 1, createdAt: -1 });
      await this.roleActionLogs.createIndex({ guildId: 1, roleType: 1 });
      await this.roleActionLogs.createIndex({ targetUserId: 1, createdAt: -1 });
      await this.roleActionLogs.createIndex({ targetFactionId: 1, createdAt: -1 });
      
      await this.roleStatuses.createIndex({ userId: 1, expiresAt: 1 });
      await this.roleStatuses.createIndex({ targetUserId: 1, expiresAt: 1 });
      await this.roleStatuses.createIndex({ targetFactionId: 1, expiresAt: 1 });
      await this.roleStatuses.createIndex({ expiresAt: 1 }); // For expiration cleanup

      // Tournaments indexes
      await this.tournaments.createIndex({ id: 1 }, { unique: true });
      await this.tournaments.createIndex({ guildId: 1, status: 1 });
      await this.tournaments.createIndex({ guildId: 1, currentRound: 1 });

      await this.tournamentMatches.createIndex({ id: 1 }, { unique: true });
      await this.tournamentMatches.createIndex({ tournamentId: 1, round: 1 });
      await this.tournamentMatches.createIndex({ guildId: 1, round: 1 });
      await this.tournamentMatches.createIndex({ factionAId: 1, round: 1 });
      await this.tournamentMatches.createIndex({ factionBId: 1, round: 1 });

      logger.info('Database indexes created successfully');
    } catch (error) {
      logger.error('Error creating indexes:', error);
      throw error;
    }
  }

  /**
   * Check if database is connected
   */
  isReady(): boolean {
    return this.isConnected;
  }
}

// Lightweight MongoDB call metrics (disabled by default; enable with DB_CALL_METRICS_ENABLED=true)
const DB_CALL_METRICS_ENABLED = process.env.DB_CALL_METRICS_ENABLED === 'true';

// Set of instrumented operations (hoisted to module scope to avoid reallocation)
const INSTRUMENTED_OPS = new Set([
  'find',
  'findOne',
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'bulkWrite',
  'countDocuments',
  'aggregate',
  'distinct',
]);

type DbCallMetrics = Record<string, number>;
const dbCallMetrics: DbCallMetrics = {};

function recordDbCall(operation: string, collection: string): void {
  if (!DB_CALL_METRICS_ENABLED) return;
  const key = `${collection}:${operation}`;
  dbCallMetrics[key] = (dbCallMetrics[key] ?? 0) + 1;
}

function flushDbCallMetrics(): void {
  if (!DB_CALL_METRICS_ENABLED) return;

  const keys = Object.keys(dbCallMetrics);
  if (keys.length === 0) return;

  const snapshot = {
    ts: new Date().toISOString(),
    type: 'mongo',
    metrics: { ...dbCallMetrics },
  };

  for (const key of keys) {
    delete dbCallMetrics[key];
  }

  const dir = path.join(process.cwd(), 'db-calls');

  fs.mkdir(dir, { recursive: true }, (mkdirErr) => {
    if (mkdirErr) {
      logger.warn('Failed to create db-calls directory for Mongo metrics:', mkdirErr);
      return;
    }

    const filePath = path.join(dir, `${new Date().toISOString().slice(0, 10)}.log`);
    const line = JSON.stringify(snapshot) + '\n';

    fs.appendFile(filePath, line, (appendErr) => {
      if (appendErr) {
        logger.warn('Failed to write Mongo DB call metrics:', appendErr);
      }
    });
  });
}

if (DB_CALL_METRICS_ENABLED) {
  const intervalMs = Number(process.env.DB_CALL_METRICS_INTERVAL_MS || '60000');
  setInterval(flushDbCallMetrics, intervalMs).unref();
}

// Export singleton instance
export const database = new DatabaseClient();
