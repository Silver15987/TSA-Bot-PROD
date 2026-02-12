import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';
import { config } from '../core/config';
import logger from '../core/logger';

/**
 * Redis Client Manager
 */
class RedisClient {
  private client: Redis | null = null;
  private isConnected = false;

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      logger.warn('Redis already connected');
      return;
    }

    try {
      logger.info('Connecting to Azure Redis Cache...');

      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        tls: config.redis.tls ? {
          servername: config.redis.host,
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.3',
          rejectUnauthorized: true,
        } : undefined,
        connectTimeout: 30000,
        keepAlive: 30000,
        maxRetriesPerRequest: null,
        retryStrategy: (times) => {
          if (times > 10) {
            logger.error('Redis connection failed after 10 attempts');
            return null; // Stop retrying
          }
          const delay = Math.min(times * 100, 3000);
          logger.warn(`Redis connection retry attempt ${times}, delay: ${delay}ms`);
          return delay;
        },
        enableReadyCheck: true,
        lazyConnect: false,
        enableOfflineQueue: true,
        reconnectOnError: (err) => {
          const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
          return targetErrors.some(targetError => err.message.includes(targetError));
        },
      });

      // Event listeners
      this.client.on('connect', () => {
        logger.info('Redis client connected');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        logger.info('Redis client ready');
      });

      this.client.on('error', (error) => {
        logger.error('Redis client error:', error);
      });

      this.client.on('close', () => {
        this.isConnected = false;
        logger.warn('Redis connection closed');
      });

      this.client.on('reconnecting', () => {
        logger.info('Redis client reconnecting...');
      });

      // Wait for connection
      await this.client.ping();
      logger.info('Successfully connected to Azure Redis Cache');
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Disconnected from Redis');
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
      throw error;
    }
  }

  /**
   * Get Redis client instance
   */
  getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis not connected. Call connect() first.');
    }

    if (!DB_CALL_METRICS_ENABLED) {
      return this.client;
    }

    // Return a proxied client that intercepts command invocations for metrics
    return new Proxy(this.client, {
      get(target, prop, receiver) {
        const value = (target as any)[prop];

        if (typeof value !== 'function') {
          return Reflect.get(target, prop, receiver);
        }

        const operation = String(prop);

        // Intercept Redis commands (common ones)
        if (
          operation === 'sadd' ||
          operation === 'smembers' ||
          operation === 'mget' ||
          operation === 'srem' ||
          operation === 'get' ||
          operation === 'set' ||
          operation === 'setex' ||
          operation === 'del' ||
          operation === 'exists' ||
          operation === 'expire' ||
          operation === 'incr' ||
          operation === 'decr' ||
          operation === 'pipeline' ||
          operation === 'multi'
        ) {
          return (...args: any[]) => {
            recordRedisCall(operation);
            const result = (value as Function).apply(target, args);

            // Wrap pipeline/multi results to instrument individual commands
            if ((operation === 'pipeline' || operation === 'multi') && result && typeof result === 'object') {
              return new Proxy(result, {
                get(pipeTarget, pipeProp, pipeReceiver) {
                  const pipeValue = (pipeTarget as any)[pipeProp];
                  if (typeof pipeValue === 'function') {
                    return (...pipeArgs: any[]) => {
                      const pipeOp = String(pipeProp);
                      recordRedisCall(`${operation}:${pipeOp}`);
                      return (pipeValue as Function).apply(pipeTarget, pipeArgs);
                    };
                  }
                  return Reflect.get(pipeTarget, pipeProp, pipeReceiver);
                },
              });
            }

            return result;
          };
        }

        return value.bind(target);
      },
    }) as Redis;
  }

  /**
   * Helper: Get value
   */
  async get(key: string): Promise<string | null> {
    recordRedisCall('get');
    return this.getClient().get(key);
  }

  /**
   * Helper: Set value
   */
  async set(key: string, value: string): Promise<void> {
    recordRedisCall('set');
    await this.getClient().set(key, value);
  }

  /**
   * Helper: Set value with expiration (seconds)
   */
  async setex(key: string, seconds: number, value: string): Promise<void> {
    recordRedisCall('setex');
    await this.getClient().setex(key, seconds, value);
  }

  /**
   * Helper: Delete key
   */
  async del(key: string): Promise<void> {
    recordRedisCall('del');
    await this.getClient().del(key);
  }

  /**
   * Helper: Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    recordRedisCall('exists');
    const result = await this.getClient().exists(key);
    return result === 1;
  }

  /**
   * Helper: Set expiration
   */
  async expire(key: string, seconds: number): Promise<void> {
    recordRedisCall('expire');
    await this.getClient().expire(key, seconds);
  }

  /**
   * Helper: Increment value
   */
  async incr(key: string): Promise<number> {
    recordRedisCall('incr');
    return this.getClient().incr(key);
  }

  /**
   * Helper: Decrement value
   */
  async decr(key: string): Promise<number> {
    recordRedisCall('decr');
    return this.getClient().decr(key);
  }

  /**
   * Check if Redis is connected
   */
  isReady(): boolean {
    return this.isConnected;
  }
}

/**
 * Redis key patterns for organization
 */
export const RedisKeys = {
  // VC Sessions: vc_session:{userId}
  vcSession: (userId: string) => `vc_session:${userId}`,

  // Gambling Cooldowns: gambling_cooldown:{userId}
  gamblingCooldown: (userId: string) => `gambling_cooldown:${userId}`,

  // Leaderboard Cache: leaderboard:{guildId}:{type}:{timeframe}
  leaderboard: (guildId: string, type: string, timeframe: string) =>
    `leaderboard:${guildId}:${type}:${timeframe}`,

  // Quest Progress: quest_progress:{factionId}:{questId}
  questProgress: (factionId: string, questId: string) =>
    `quest_progress:${factionId}:${questId}`,

  // War Progress: war_progress:{warId}:{factionId}
  warProgress: (warId: string, factionId: string) =>
    `war_progress:${warId}:${factionId}`,

  // Multiplier Cache: multiplier:user:{userId}:{guildId}
  userMultiplier: (userId: string, guildId: string) => `multiplier:user:${userId}:${guildId}`,

  // Multiplier Cache: multiplier:faction:{factionId}:{guildId}
  factionMultiplier: (factionId: string, guildId: string) => `multiplier:faction:${factionId}:${guildId}`,

  // Multiplier Cache: multiplier:total:{userId}:{guildId}
  totalMultiplier: (userId: string, guildId: string) => `multiplier:total:${userId}:${guildId}`,

  // Status Cache: status:user:{userId}:{guildId}
  userStatuses: (userId: string, guildId: string) => `status:user:${userId}:${guildId}`,

  // Items Cache: items:user:{userId}:{guildId}
  userItems: (userId: string, guildId: string) => `items:user:${userId}:${guildId}`,

  // Tournament: active state per guild
  tournamentState: (guildId: string) => `tournament:state:${guildId}`,

  // Tournament: pairings per round
  tournamentPairings: (tournamentId: string, round: number) =>
    `tournament:pairings:${tournamentId}:${round}`,

  // Tournament: joined roster per faction
  tournamentRosterJoined: (tournamentId: string, factionId: string) =>
    `tournament:roster:joined:${tournamentId}:${factionId}`,

  // Tournament: per-voter votes for a faction in a given round
  tournamentVotes: (tournamentId: string, round: number, factionId: string, voterId: string) =>
    `tournament:votes:${tournamentId}:${round}:${factionId}:${voterId}`,

  // Tournament: aggregated vote totals per faction in a round
  tournamentVoteTotals: (tournamentId: string, round: number, factionId: string) =>
    `tournament:voteTotals:${tournamentId}:${round}:${factionId}`,

  // Tournament: locked roster per faction in a round
  tournamentLockedRoster: (tournamentId: string, round: number, factionId: string) =>
    `tournament:lockedRoster:${tournamentId}:${round}:${factionId}`,

  // Tournament: cached VC totals per user per round
  tournamentVc: (tournamentId: string, round: number, userId: string) =>
    `tournament:vc:${tournamentId}:${round}:${userId}`,
};

// Lightweight Redis call metrics (shares DB_CALL_METRICS_ENABLED flag with Mongo metrics)
const DB_CALL_METRICS_ENABLED = process.env.DB_CALL_METRICS_ENABLED === 'true';

type RedisCallMetrics = Record<string, number>;
const redisCallMetrics: RedisCallMetrics = {};

function recordRedisCall(operation: string): void {
  if (!DB_CALL_METRICS_ENABLED) return;
  const key = operation;
  redisCallMetrics[key] = (redisCallMetrics[key] ?? 0) + 1;
}

function flushRedisCallMetrics(): void {
  if (!DB_CALL_METRICS_ENABLED) return;

  const keys = Object.keys(redisCallMetrics);
  if (keys.length === 0) return;

  const snapshot = {
    ts: new Date().toISOString(),
    type: 'redis',
    metrics: { ...redisCallMetrics },
  };

  for (const key of keys) {
    delete redisCallMetrics[key];
  }

  const dir = path.join(process.cwd(), 'db-calls');

  fs.mkdir(dir, { recursive: true }, (mkdirErr) => {
    if (mkdirErr) {
      logger.warn('Failed to create db-calls directory for Redis metrics:', mkdirErr);
      return;
    }

    const filePath = path.join(dir, `${new Date().toISOString().slice(0, 10)}.log`);
    const line = JSON.stringify(snapshot) + '\n';

    fs.appendFile(filePath, line, (appendErr) => {
      if (appendErr) {
        logger.warn('Failed to write Redis call metrics:', appendErr);
      }
    });
  });
}

if (DB_CALL_METRICS_ENABLED) {
  const intervalMs = Number(process.env.DB_CALL_METRICS_INTERVAL_MS || '60000');
  setInterval(flushRedisCallMetrics, intervalMs).unref();
}

// Export singleton instance
export const redis = new RedisClient();
