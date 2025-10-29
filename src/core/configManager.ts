import { database } from '../database/client';
import { ServerConfigDocument } from '../types/database';
import { config } from './config';
import logger from './logger';

/**
 * Configuration Manager
 * Handles loading, caching, and reloading server-specific configuration from database
 */
class ConfigManager {
  private configCache: Map<string, ServerConfigDocument> = new Map();
  private loadTimestamps: Map<string, Date> = new Map();

  /**
   * Load configuration from database for a specific guild
   */
  async loadConfig(guildId: string): Promise<ServerConfigDocument> {
    try {
      let serverConfig = await database.serverConfigs.findOne({ guildId });

      if (!serverConfig) {
        logger.info(`No config found for guild ${guildId}, creating default config`);
        const newConfig = await this.createDefaultConfig(guildId);
        this.configCache.set(guildId, newConfig);
        this.loadTimestamps.set(guildId, new Date());
        logger.info(`Loaded config for guild ${guildId} (version ${newConfig.version})`);
        return newConfig;
      }

      // Migration: Convert old single trackedCategoryId to array trackedCategoryIds
      if (serverConfig.vcTracking && 'trackedCategoryId' in serverConfig.vcTracking) {
        logger.info(`Migrating config for guild ${guildId}: trackedCategoryId → trackedCategoryIds`);
        const oldCategoryId = (serverConfig.vcTracking as any).trackedCategoryId;

        await database.serverConfigs.updateOne(
          { guildId },
          {
            $set: {
              'vcTracking.trackedCategoryIds': [oldCategoryId],
            },
            $unset: {
              'vcTracking.trackedCategoryId': '',
            },
            $inc: { version: 1 },
          }
        );

        // Reload the updated config
        serverConfig = await database.serverConfigs.findOne({ guildId });
        if (!serverConfig) {
          throw new Error(`Failed to reload config after migration for guild ${guildId}`);
        }
        logger.info(`Migration complete for guild ${guildId} (version ${serverConfig.version})`);
      }

      this.configCache.set(guildId, serverConfig);
      this.loadTimestamps.set(guildId, new Date());

      logger.info(`Loaded config for guild ${guildId} (version ${serverConfig.version})`);
      return serverConfig;
    } catch (error) {
      logger.error(`Failed to load config for guild ${guildId}:`, error);
      throw error;
    }
  }

  /**
   * Get cached configuration for a guild
   * Falls back to loading if not cached
   */
  getConfig(guildId: string): ServerConfigDocument {
    const cached = this.configCache.get(guildId);

    if (!cached) {
      throw new Error(`Config not loaded for guild ${guildId}. Call loadConfig() first.`);
    }

    return cached;
  }

  /**
   * Check if cached config exists
   */
  hasConfig(guildId: string): boolean {
    return this.configCache.has(guildId);
  }

  /**
   * Reload configuration from database
   */
  async reloadConfig(guildId: string): Promise<void> {
    logger.info(`Reloading config for guild ${guildId}`);
    await this.loadConfig(guildId);
  }

  /**
   * Check if config has been updated in database
   */
  async checkForUpdates(guildId: string): Promise<boolean> {
    const cached = this.configCache.get(guildId);

    if (!cached) {
      return false;
    }

    try {
      const latest = await database.serverConfigs.findOne({ guildId });

      if (!latest) {
        return false;
      }

      return latest.version > cached.version;
    } catch (error) {
      logger.error(`Failed to check for config updates for guild ${guildId}:`, error);
      return false;
    }
  }

  /**
   * Create default configuration for a new guild
   */
  private async createDefaultConfig(guildId: string): Promise<ServerConfigDocument> {
    const defaultConfig = {
      guildId,

      vcTracking: {
        enabled: true,
        trackedCategoryIds: this.parseCategoryIds(),
        coinsPerSecond: parseFloat(config.economy.coinsPerSecond.toString()) || 0.1,
        sessionTTL: 86400,
        syncInterval: 300,
      },

      economy: {
        startingCoins: 1000,
      },

      factions: {
        enabled: true,
        factionCategoryId: process.env.FACTION_CATEGORY_ID || '',
        maxFactionsPerServer: config.bot.maxFactionsPerServer || 50,
        createCost: config.bot.factionCreateCost || 10000,
        minInitialDeposit: 5000,
        dailyUpkeepCost: config.bot.dailyUpkeepCost || 500,
        maxMembersPerFaction: 50,
        welcomeMessages: [
          'Welcome to {factionName}! Time to hit the books! 📚',
          '{username} just joined {factionName}! Let\'s study together! 🎓',
          'A new scholar has arrived! Welcome, {username}! 📖',
          '{factionName} grows stronger with {username}! 💪',
          'Welcome aboard, {username}! Ready to grind? 🔥',
        ],
        announcementChannelId: '',
      },

      gambling: {
        enabled: true,
        coinflip: {
          minBet: config.gambling.coinflip.minBet || 100,
          maxBet: config.gambling.coinflip.maxBet || 50000,
          houseEdge: config.gambling.coinflip.houseEdge || 0.02,
        },
        slots: {
          minBet: config.gambling.slots.minBet || 50,
          maxBet: config.gambling.slots.maxBet || 25000,
          houseEdge: config.gambling.slots.houseEdge || 0.05,
        },
      },

      admin: {
        staffRoleIds: [],
        auditLogChannelId: '',
      },

      quests: {
        enabled: true,
        acceptanceWindowHours: 3,
        cooldownHours: 3,
        autoAssignEnabled: true,
        autoAssignIntervalHours: 6,
        difficultyScaling: {
          easy: {
            maxMembers: 5,
            vcTimeMultiplier: 1.0,
            coinsMultiplier: 1.0,
          },
          medium: {
            maxMembers: 10,
            vcTimeMultiplier: 1.5,
            coinsMultiplier: 1.5,
          },
          hard: {
            maxMembers: 999,
            vcTimeMultiplier: 2.0,
            coinsMultiplier: 2.0,
          },
        },
      },

      updatedAt: new Date(),
      updatedBy: 'system',
      version: 1,
    };

    await database.serverConfigs.insertOne(defaultConfig);
    logger.info(`Created default config for guild ${guildId}`);

    // Fetch the inserted document to get the full WithId type
    const insertedConfig = await database.serverConfigs.findOne({ guildId });
    if (!insertedConfig) {
      throw new Error(`Failed to retrieve inserted config for guild ${guildId}`);
    }

    return insertedConfig;
  }

  /**
   * Parse category IDs from environment variables
   * Supports both VC_CATEGORY_IDS (comma-separated) and VC_CATEGORY_ID (single, backward compatible)
   */
  private parseCategoryIds(): string[] {
    // Check for new format first (comma-separated)
    if (process.env.VC_CATEGORY_IDS) {
      return process.env.VC_CATEGORY_IDS.split(',')
        .map(id => id.trim())
        .filter(id => id.length > 0);
    }

    // Fall back to old format (single category)
    if (process.env.VC_CATEGORY_ID) {
      return [process.env.VC_CATEGORY_ID];
    }

    // Default fallback
    return ['719217565263593482'];
  }

  /**
   * Clear cache for a guild
   */
  clearCache(guildId: string): void {
    this.configCache.delete(guildId);
    this.loadTimestamps.delete(guildId);
  }

  /**
   * Clear all cached configs
   */
  clearAllCache(): void {
    this.configCache.clear();
    this.loadTimestamps.clear();
  }

  /**
   * Get all cached guild IDs
   */
  getCachedGuilds(): string[] {
    return Array.from(this.configCache.keys());
  }
}

export const configManager = new ConfigManager();
