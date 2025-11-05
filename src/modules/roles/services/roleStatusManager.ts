import { database } from '../../../database/client';
import { RoleType, RoleStatusDocument } from '../../../types/database';
import logger from '../../../core/logger';

export interface StatusData {
  guildId: string;
  userId: string; // Caster/owner
  targetUserId?: string;
  targetFactionId?: string;
  roleType: RoleType;
  effectType: 'protection' | 'curse' | 'blessing' | 'investment' | 'wanted' | 'market_manipulation';
  expiresAt: Date | null;
  metadata?: Record<string, any>;
}

/**
 * Role Status Manager
 * Manages active role effects (curses, blessings, guards, investments)
 */
export class RoleStatusManager {
  /**
   * Generate unique status ID
   */
  private generateStatusId(): string {
    return `status_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Apply a status effect
   */
  async applyStatus(data: StatusData): Promise<string | null> {
    try {
      const statusId = this.generateStatusId();
      const statusDoc: RoleStatusDocument = {
        id: statusId,
        guildId: data.guildId,
        userId: data.userId,
        targetUserId: data.targetUserId,
        targetFactionId: data.targetFactionId,
        roleType: data.roleType,
        effectType: data.effectType,
        expiresAt: data.expiresAt,
        metadata: data.metadata || {},
        createdAt: new Date(),
      };

      await database.roleStatuses.insertOne(statusDoc);
      logger.info(`Applied status ${data.effectType} (${statusId}) by ${data.userId}`);
      return statusId;
    } catch (error) {
      logger.error(`Error applying status:`, error);
      return null;
    }
  }

  /**
   * Remove a status effect
   */
  async removeStatus(statusId: string): Promise<boolean> {
    try {
      const result = await database.roleStatuses.deleteOne({ id: statusId });
      if (result.deletedCount > 0) {
        logger.info(`Removed status ${statusId}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Error removing status ${statusId}:`, error);
      return false;
    }
  }

  /**
   * Get active statuses for a target user
   */
  async getActiveStatusesForUser(
    targetUserId: string,
    guildId: string,
    effectType?: RoleStatusDocument['effectType']
  ): Promise<RoleStatusDocument[]> {
    try {
      const query: any = {
        targetUserId,
        guildId,
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } },
        ],
      };

      if (effectType) {
        query.effectType = effectType;
      }

      return await database.roleStatuses.find(query).toArray();
    } catch (error) {
      logger.error(`Error getting active statuses for user ${targetUserId}:`, error);
      return [];
    }
  }

  /**
   * Get active statuses for a target faction
   */
  async getActiveStatusesForFaction(
    targetFactionId: string,
    guildId: string,
    effectType?: RoleStatusDocument['effectType']
  ): Promise<RoleStatusDocument[]> {
    try {
      const query: any = {
        targetFactionId,
        guildId,
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } },
        ],
      };

      if (effectType) {
        query.effectType = effectType;
      }

      return await database.roleStatuses.find(query).toArray();
    } catch (error) {
      logger.error(`Error getting active statuses for faction ${targetFactionId}:`, error);
      return [];
    }
  }

  /**
   * Get active statuses owned by a user
   */
  async getActiveStatusesByUser(
    userId: string,
    guildId: string,
    effectType?: RoleStatusDocument['effectType']
  ): Promise<RoleStatusDocument[]> {
    try {
      const query: any = {
        userId,
        guildId,
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } },
        ],
      };

      if (effectType) {
        query.effectType = effectType;
      }

      return await database.roleStatuses.find(query).toArray();
    } catch (error) {
      logger.error(`Error getting active statuses by user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Check and remove expired statuses
   */
  async checkExpiredStatuses(): Promise<number> {
    try {
      const now = new Date();
      const result = await database.roleStatuses.deleteMany({
        expiresAt: { $ne: null, $lt: now },
      });

      if (result.deletedCount > 0) {
        logger.info(`Removed ${result.deletedCount} expired statuses`);
      }

      return result.deletedCount;
    } catch (error) {
      logger.error('Error checking expired statuses:', error);
      return 0;
    }
  }

  /**
   * Remove all statuses of a specific type for a target
   */
  async removeStatusesByType(
    targetUserId: string | undefined,
    targetFactionId: string | undefined,
    guildId: string,
    effectType: RoleStatusDocument['effectType']
  ): Promise<number> {
    try {
      const query: any = {
        guildId,
        effectType,
      };

      if (targetUserId) {
        query.targetUserId = targetUserId;
      }

      if (targetFactionId) {
        query.targetFactionId = targetFactionId;
      }

      const result = await database.roleStatuses.deleteMany(query);
      return result.deletedCount;
    } catch (error) {
      logger.error('Error removing statuses by type:', error);
      return 0;
    }
  }
}

export const roleStatusManager = new RoleStatusManager();

