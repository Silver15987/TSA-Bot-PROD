import { database } from '../../../database/client';
import { RoleType, RoleActionLogDocument } from '../../../types/database';
import logger from '../../../core/logger';

export interface ActionLogData {
  guildId: string;
  userId: string;
  roleType: RoleType;
  abilityName: string;
  targetUserId?: string;
  targetFactionId?: string;
  success: boolean;
  amount?: number;
  metadata?: Record<string, any>;
}

/**
 * Role Action Logger
 * Logs all role ability interactions for audit/history
 */
export class RoleActionLogger {
  /**
   * Generate unique log ID
   */
  private generateLogId(): string {
    return `log_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Log an action
   */
  async logAction(data: ActionLogData): Promise<boolean> {
    try {
      const logDoc: RoleActionLogDocument = {
        id: this.generateLogId(),
        guildId: data.guildId,
        userId: data.userId,
        roleType: data.roleType,
        abilityName: data.abilityName,
        targetUserId: data.targetUserId,
        targetFactionId: data.targetFactionId,
        success: data.success,
        amount: data.amount,
        metadata: data.metadata || {},
        createdAt: new Date(),
      };

      await database.roleActionLogs.insertOne(logDoc);
      logger.debug(`Logged role action: ${data.roleType}.${data.abilityName} by ${data.userId}`);
      return true;
    } catch (error) {
      logger.error(`Error logging role action:`, error);
      return false;
    }
  }

  /**
   * Get user's action history
   */
  async getUserActionHistory(
    userId: string,
    guildId: string,
    filters?: {
      roleType?: RoleType;
      abilityName?: string;
      limit?: number;
    }
  ): Promise<RoleActionLogDocument[]> {
    try {
      const query: any = {
        userId,
        guildId,
      };

      if (filters?.roleType) {
        query.roleType = filters.roleType;
      }

      if (filters?.abilityName) {
        query.abilityName = filters.abilityName;
      }

      const limit = filters?.limit || 50;

      return await database.roleActionLogs
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      logger.error(`Error getting user action history for ${userId}:`, error);
      return [];
    }
  }

  /**
   * Get faction's action history
   */
  async getFactionActionHistory(
    factionId: string,
    guildId: string,
    filters?: {
      roleType?: RoleType;
      abilityName?: string;
      limit?: number;
    }
  ): Promise<RoleActionLogDocument[]> {
    try {
      const query: any = {
        $or: [
          { targetFactionId: factionId },
          { targetFactionId: { $exists: false } }, // Actions targeting the faction itself
        ],
        guildId,
      };

      if (filters?.roleType) {
        query.roleType = filters.roleType;
      }

      if (filters?.abilityName) {
        query.abilityName = filters.abilityName;
      }

      const limit = filters?.limit || 50;

      return await database.roleActionLogs
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      logger.error(`Error getting faction action history for ${factionId}:`, error);
      return [];
    }
  }

  /**
   * Get actions targeting a user
   */
  async getTargetUserHistory(
    targetUserId: string,
    guildId: string,
    limit: number = 50
  ): Promise<RoleActionLogDocument[]> {
    try {
      return await database.roleActionLogs
        .find({
          targetUserId,
          guildId,
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      logger.error(`Error getting target user history for ${targetUserId}:`, error);
      return [];
    }
  }
}

export const roleActionLogger = new RoleActionLogger();

