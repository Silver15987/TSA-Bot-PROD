/**
 * Centralized guard for role system enable/disable
 * Caches config to minimize RU usage
 */
import { configManager } from '../../../core/configManager';
import logger from '../../../core/logger';

class RoleSystemGuard {
  private cachedEnabled: boolean | null = null;
  private lastCheck: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute cache

  /**
   * Check if role system is enabled
   * Uses cached value to minimize DB reads
   */
  isEnabled(): boolean {
    const now = Date.now();
    
    // Use cached value if within TTL
    if (this.cachedEnabled !== null && (now - this.lastCheck) < this.CACHE_TTL) {
      return this.cachedEnabled;
    }

    // Refresh cache
    try {
      if (!configManager.hasConfig()) {
        // Fail-open: if config not loaded yet, allow roles
        logger.debug('Config not loaded, defaulting role system to enabled');
        return true;
      }

      const config = configManager.getConfig();
      this.cachedEnabled = config.roles?.enabled !== false;
      this.lastCheck = now;
      
      return this.cachedEnabled;
    } catch (error) {
      logger.error('Error checking role system status:', error);
      // Fail-open: if error, allow roles to avoid breaking functionality
      return true;
    }
  }

  /**
   * Clear cache (call when config is updated)
   */
  clearCache(): void {
    this.cachedEnabled = null;
    this.lastCheck = 0;
  }

  /**
   * Get disabled message for users
   */
  getDisabledMessage(): string {
    return '❌ The role system is currently disabled on this server.';
  }
}

export const roleSystemGuard = new RoleSystemGuard();
