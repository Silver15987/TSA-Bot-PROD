import Redis from 'ioredis';
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
    return this.client;
  }

  /**
   * Helper: Get value
   */
  async get(key: string): Promise<string | null> {
    return this.getClient().get(key);
  }

  /**
   * Helper: Set value
   */
  async set(key: string, value: string): Promise<void> {
    await this.getClient().set(key, value);
  }

  /**
   * Helper: Set value with expiration (seconds)
   */
  async setex(key: string, seconds: number, value: string): Promise<void> {
    await this.getClient().setex(key, seconds, value);
  }

  /**
   * Helper: Delete key
   */
  async del(key: string): Promise<void> {
    await this.getClient().del(key);
  }

  /**
   * Helper: Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.getClient().exists(key);
    return result === 1;
  }

  /**
   * Helper: Set expiration
   */
  async expire(key: string, seconds: number): Promise<void> {
    await this.getClient().expire(key, seconds);
  }

  /**
   * Helper: Increment value
   */
  async incr(key: string): Promise<number> {
    return this.getClient().incr(key);
  }

  /**
   * Helper: Decrement value
   */
  async decr(key: string): Promise<number> {
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
};

// Export singleton instance
export const redis = new RedisClient();
