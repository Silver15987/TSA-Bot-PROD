import { redis } from '../../../cache/client';
import { configManager } from '../../../core/configManager';
import logger from '../../../core/logger';
import { VCSession } from '../types';

/**
 * Session Manager
 * Manages voice channel sessions in Redis
 */
export class SessionManager {
  /**
   * Create a new VC session
   */
  async createSession(
    userId: string,
    guildId: string,
    channelId: string,
    factionId?: string // Optional: faction ID if in faction VC
  ): Promise<void> {
    try {
      // Check if Redis is connected
      if (!redis.isReady()) {
        logger.error(`Cannot create session for user ${userId}: Redis not connected`);
        return; // Gracefully fail without throwing
      }

      const now = Date.now();
      const session: VCSession = {
        userId,
        guildId,
        channelId,
        joinedAt: now,
        sessionStartTime: now, // Set original start time
        factionId, // Store faction ID if present
      };

      const key = this.getSessionKey(guildId, userId);
      const config = configManager.getConfig(guildId);
      const ttl = config.vcTracking.sessionTTL;

      await redis.setex(key, ttl, JSON.stringify(session));

      logger.info(`Session created for user ${userId} in channel ${channelId} (guild: ${guildId}, faction: ${factionId || 'none'})`);
    } catch (error) {
      logger.error(`Failed to create session for user ${userId}:`, error);
      // Don't re-throw - error is logged, let caller continue
    }
  }

  /**
   * Get active session for a user
   */
  async getSession(userId: string, guildId: string): Promise<VCSession | null> {
    try {
      const key = this.getSessionKey(guildId, userId);
      const sessionData = await redis.get(key);

      if (!sessionData) {
        return null;
      }

      return JSON.parse(sessionData) as VCSession;
    } catch (error) {
      logger.error(`Failed to get session for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(userId: string, guildId: string): Promise<void> {
    try {
      // Check if Redis is connected
      if (!redis.isReady()) {
        logger.error(`Cannot delete session for user ${userId}: Redis not connected`);
        return; // Gracefully fail without throwing
      }

      const key = this.getSessionKey(guildId, userId);
      await redis.del(key);

      logger.info(`Session deleted for user ${userId} (guild: ${guildId})`);
    } catch (error) {
      logger.error(`Failed to delete session for user ${userId}:`, error);
      // Don't re-throw - error is logged, let caller continue
    }
  }

  /**
   * Check if user has an active session
   */
  async hasActiveSession(userId: string, guildId: string): Promise<boolean> {
    const session = await this.getSession(userId, guildId);
    return session !== null;
  }

  /**
   * Get all active sessions for a guild
   */
  async getAllActiveSessions(guildId: string): Promise<VCSession[]> {
    try {
      const pattern = this.getSessionPattern(guildId);
      const keys = await redis.getClient().keys(pattern);

      const sessions: VCSession[] = [];

      for (const key of keys) {
        const sessionData = await redis.get(key);
        if (sessionData) {
          sessions.push(JSON.parse(sessionData) as VCSession);
        }
      }

      return sessions;
    } catch (error) {
      logger.error(`Failed to get all sessions for guild ${guildId}:`, error);
      return [];
    }
  }

  /**
   * Transfer session to a new channel (for quick moves like Join-to-Create)
   */
  async transferSession(
    userId: string,
    guildId: string,
    newChannelId: string,
    factionId?: string
  ): Promise<void> {
    try {
      // Check if Redis is connected
      if (!redis.isReady()) {
        logger.error(`Cannot transfer session for user ${userId}: Redis not connected`);
        return; // Gracefully fail without throwing
      }

      const session = await this.getSession(userId, guildId);

      if (!session) {
        logger.warn(`Cannot transfer session: No session found for user ${userId}`);
        return;
      }

      // Store old channel ID and mark as transferred
      session.oldChannelId = session.channelId;
      session.channelId = newChannelId;
      session.transferred = true;
      session.factionId = factionId; // Update faction ID if applicable

      const key = this.getSessionKey(guildId, userId);
      const config = configManager.getConfig(guildId);
      const ttl = config.vcTracking.sessionTTL;

      await redis.setex(key, ttl, JSON.stringify(session));

      logger.info(`Session transferred for user ${userId} from ${session.oldChannelId} to ${newChannelId} (guild: ${guildId}, faction: ${factionId || 'none'})`);
    } catch (error) {
      logger.error(`Failed to transfer session for user ${userId}:`, error);
      // Don't re-throw - error is logged, let caller continue
    }
  }

  /**
   * Update session TTL (for periodic sync)
   * NOTE: This ONLY refreshes the TTL, does NOT modify session data
   * Previously this overwrote joinedAt which broke duration calculations
   */
  async refreshSessionTTL(
    userId: string,
    guildId: string
  ): Promise<void> {
    try {
      // Check if Redis is connected
      if (!redis.isReady()) {
        logger.error(`Cannot refresh session TTL for user ${userId}: Redis not connected`);
        return; // Gracefully fail without throwing
      }

      const key = this.getSessionKey(guildId, userId);
      const config = configManager.getConfig(guildId);
      const ttl = config.vcTracking.sessionTTL;

      // Simply refresh the TTL without modifying session data
      await redis.expire(key, ttl);

      logger.debug(`Session TTL refreshed for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to refresh session TTL for user ${userId}:`, error);
      // Don't re-throw - error is logged, let caller continue
    }
  }

  /**
   * @deprecated Use refreshSessionTTL() instead
   * This method is kept for backward compatibility but should not be used
   */
  async updateSessionTimestamp(
    userId: string,
    guildId: string,
    _newTimestamp: number // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<void> {
    logger.warn(`updateSessionTimestamp is deprecated, use refreshSessionTTL instead`);
    await this.refreshSessionTTL(userId, guildId);
  }

  /**
   * Calculate session duration
   * CRITICAL: Uses sessionStartTime (immutable) not joinedAt (which gets updated)
   */
  calculateDuration(session: VCSession): number {
    return Date.now() - session.sessionStartTime;
  }

  /**
   * Get session key pattern for Redis
   */
  private getSessionKey(guildId: string, userId: string): string {
    return `vc_session:${guildId}:${userId}`;
  }

  /**
   * Get pattern for all sessions in a guild
   */
  private getSessionPattern(guildId: string): string {
    return `vc_session:${guildId}:*`;
  }
}

export const sessionManager = new SessionManager();
