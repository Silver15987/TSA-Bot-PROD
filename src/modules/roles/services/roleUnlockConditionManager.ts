import { database } from '../../../database/client';
import { RoleType, RoleUnlockConditionDocument } from '../../../types/database';
import logger from '../../../core/logger';

export interface ConditionConfig {
  type: 'faction_deposit' | 'coins_spent' | 'quest';
  value: number | string; // Amount for deposit/spent, questId for quest
}

/**
 * Role Unlock Condition Manager
 * Manages admin-configured unlock conditions for roles
 */
export class RoleUnlockConditionManager {
  /**
   * Set unlock conditions for a role
   */
  async setConditions(
    guildId: string,
    roleType: RoleType,
    conditions: ConditionConfig[]
  ): Promise<boolean> {
    try {
      await database.roleUnlockConditions.updateOne(
        { guildId, roleType },
        {
          $set: {
            conditions,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );

      logger.info(`Set unlock conditions for role ${roleType} in guild ${guildId}`);
      return true;
    } catch (error) {
      logger.error(`Error setting unlock conditions for ${roleType}:`, error);
      return false;
    }
  }

  /**
   * Get unlock conditions for a role
   */
  async getConditions(guildId: string, roleType: RoleType): Promise<ConditionConfig[] | null> {
    try {
      const doc = await database.roleUnlockConditions.findOne({ guildId, roleType });
      return doc?.conditions || null;
    } catch (error) {
      logger.error(`Error getting unlock conditions for ${roleType}:`, error);
      return null;
    }
  }

  /**
   * Validate if user meets all conditions for a role
   */
  async validateConditions(
    userId: string,
    guildId: string,
    roleType: RoleType
  ): Promise<boolean> {
    try {
      const conditions = await this.getConditions(guildId, roleType);
      if (!conditions || conditions.length === 0) {
        return false; // No conditions configured
      }

      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        return false;
      }

      const progress = user.roleProgress || [];
      const roleProgress = progress.find(p => p.roleType === roleType);

      if (!roleProgress) {
        return false; // No progress tracked yet
      }

      // Check each condition
      for (const condition of conditions) {
        if (condition.type === 'faction_deposit') {
          const required = condition.value as number;
          const current = roleProgress.conditions.factionDeposit || 0;
          if (current < required) {
            return false;
          }
        } else if (condition.type === 'coins_spent') {
          const required = condition.value as number;
          const current = roleProgress.conditions.coinsSpent || 0;
          if (current < required) {
            return false;
          }
        } else if (condition.type === 'quest') {
          const requiredQuestId = condition.value as string;
          const completedQuests = roleProgress.conditions.questsCompleted || [];
          if (!completedQuests.includes(requiredQuestId)) {
            return false;
          }
        }
      }

      return true; // All conditions met
    } catch (error) {
      logger.error(`Error validating conditions for ${roleType}:`, error);
      return false;
    }
  }

  /**
   * Get all role conditions for a guild
   */
  async getAllConditions(guildId: string): Promise<RoleUnlockConditionDocument[]> {
    try {
      return await database.roleUnlockConditions.find({ guildId }).toArray();
    } catch (error) {
      logger.error(`Error getting all conditions for guild ${guildId}:`, error);
      return [];
    }
  }
}

export const roleUnlockConditionManager = new RoleUnlockConditionManager();

