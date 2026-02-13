/**
 * Centralized guard for role system enable/disable
 * Caches config per-guild to minimize RU usage
 */
import { configManager } from '../../../core/configManager';
import { database } from '../../../database/client';
import logger from '../../../core/logger';

interface GuildCache {
  enabled: boolean;
  lastCheck: number;
}

class RoleSystemGuard {
  private guildCache = new Map<string, GuildCache>();
  private readonly CACHE_TTL = 60000; // 1 minute cache

  /**
   * Check if role system is enabled for a specific guild
   * Uses cached value to minimize DB reads
   */
  async isEnabled(guildId: string): Promise<boolean> {
    const now = Date.now();
    
    // Use cached value if within TTL
    const cached = this.guildCache.get(guildId);
    if (cached && (now - cached.lastCheck) < this.CACHE_TTL) {
      return cached.enabled;
    }

    // Refresh cache
    try {
      let enabled: boolean;

      // Try to get from configManager first (if it's the same guild)
      if (configManager.hasConfig()) {
        try {
          const config = configManager.getConfig(guildId);
          enabled = config.roles?.enabled !== false;
        } catch (error) {
          // If configManager doesn't have this guild, fetch directly from DB
          const serverConfig = await database.serverConfigs.findOne({ guildId });
          enabled = serverConfig?.roles?.enabled !== false; // Default to true if not set
        }
      } else {
        // Fetch directly from database
        const serverConfig = await database.serverConfigs.findOne({ guildId });
        enabled = serverConfig?.roles?.enabled !== false; // Default to true if not set
      }

      // Update cache
      this.guildCache.set(guildId, {
        enabled,
        lastCheck: now,
      });
      
      return enabled;
    } catch (error) {
      logger.error(`Error checking role system status for guild ${guildId}:`, error);
      // Fail-open: if error, allow roles to avoid breaking functionality
      return true;
    }
  }

  /**
   * Synchronous version that only uses cache (for backwards compatibility)
   * Falls back to true if not cached
   */
  isEnabledSync(guildId?: string): boolean {
    if (!guildId) {
      logger.warn('roleSystemGuard.isEnabledSync called without guildId, defaulting to enabled');
      return true;
    }

    const cached = this.guildCache.get(guildId);
    if (cached && (Date.now() - cached.lastCheck) < this.CACHE_TTL) {
      return cached.enabled;
    }

    // If not cached or expired, default to enabled (fail-open)
    logger.debug(`No cached role system status for guild ${guildId}, defaulting to enabled`);
    return true;
  }

  /**
   * Clear cache for a specific guild (call when config is updated)
   */
  clearCache(guildId?: string): void {
    if (guildId) {
      this.guildCache.delete(guildId);
    } else {
      // Clear all caches
      this.guildCache.clear();
    }
  }

  /**
   * Get disabled message for users
   */
  getDisabledMessage(): string {
    return '❌ The role system is currently disabled on this server.';
  }
}

export const roleSystemGuard = new RoleSystemGuard();
