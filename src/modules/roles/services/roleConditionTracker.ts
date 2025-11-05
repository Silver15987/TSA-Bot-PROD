import { database } from '../../../database/client';
import { RoleType, RoleProgressEntry } from '../../../types/database';
import logger from '../../../core/logger';
import { roleUnlockConditionManager } from './roleUnlockConditionManager';
import { roleManager } from './roleManager';

export interface ProgressUpdateResult {
  success: boolean;
  error?: string;
  roleUnlocked?: RoleType;
}

/**
 * Role Condition Tracker
 * Tracks progress toward role unlock conditions
 */
export class RoleConditionTracker {
  /**
   * Update progress for a condition type
   */
  async updateProgress(
    userId: string,
    guildId: string,
    conditionType: 'faction_deposit' | 'coins_spent' | 'quest',
    amount: number | string // Amount for deposit/spent, questId for quest
  ): Promise<ProgressUpdateResult> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        return {
          success: false,
          error: 'User not found',
        };
      }

      // Check if user already has a role
      if (user.role) {
        // User already has a role, don't update progress
        return {
          success: true,
        };
      }

      // Get all role unlock conditions for this guild
      const allRoles = ['guard', 'thief', 'witch', 'oracle', 'enchanter', 'merchant'] as RoleType[];
      
      for (const roleType of allRoles) {
        const conditions = await roleUnlockConditionManager.getConditions(guildId, roleType);
        if (!conditions || conditions.length === 0) {
          continue; // No conditions configured for this role
        }

        // Update progress for this role
        await this.updateRoleProgress(userId, guildId, roleType, conditionType, amount);

        // Check if user now meets all conditions
        const meetsConditions = await roleUnlockConditionManager.validateConditions(
          userId,
          guildId,
          roleType
        );

        if (meetsConditions) {
          // User meets conditions - assign role automatically
          const assignmentResult = await roleManager.setUserRole(userId, guildId, roleType);
          if (assignmentResult.success) {
            logger.info(`User ${userId} automatically unlocked role ${roleType} in guild ${guildId}`);
            return {
              success: true,
              roleUnlocked: roleType,
            };
          }
        }
      }

      return {
        success: true,
      };
    } catch (error) {
      logger.error(`Error updating role progress for ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update progress for a specific role
   */
  private async updateRoleProgress(
    userId: string,
    guildId: string,
    roleType: RoleType,
    conditionType: 'faction_deposit' | 'coins_spent' | 'quest',
    amount: number | string
  ): Promise<void> {
    const user = await database.users.findOne({ id: userId, guildId });
    if (!user) return;

    const progress = user.roleProgress || [];
    let roleProgress = progress.find(p => p.roleType === roleType);

    if (!roleProgress) {
      roleProgress = {
        roleType,
        conditions: {},
        lastUpdated: new Date(),
      };
      progress.push(roleProgress);
    }

    // Update the specific condition
    if (conditionType === 'faction_deposit') {
      roleProgress.conditions.factionDeposit = (roleProgress.conditions.factionDeposit || 0) + (amount as number);
    } else if (conditionType === 'coins_spent') {
      roleProgress.conditions.coinsSpent = (roleProgress.conditions.coinsSpent || 0) + Math.abs(amount as number);
    } else if (conditionType === 'quest') {
      const questsCompleted = roleProgress.conditions.questsCompleted || [];
      if (!questsCompleted.includes(amount as string)) {
        questsCompleted.push(amount as string);
      }
      roleProgress.conditions.questsCompleted = questsCompleted;
    }

    roleProgress.lastUpdated = new Date();

    // Update user document
    await database.users.updateOne(
      { id: userId, guildId },
      {
        $set: {
          roleProgress: progress,
          updatedAt: new Date(),
        },
      }
    );
  }

  /**
   * Get progress for a specific role
   */
  async getProgress(userId: string, guildId: string, roleType: RoleType): Promise<RoleProgressEntry | null> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        return null;
      }

      const progress = user.roleProgress || [];
      return progress.find(p => p.roleType === roleType) || null;
    } catch (error) {
      logger.error(`Error getting role progress for ${userId}:`, error);
      return null;
    }
  }

  /**
   * Get all progress for user
   */
  async getAllProgress(userId: string, guildId: string): Promise<RoleProgressEntry[]> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      return user?.roleProgress || [];
    } catch (error) {
      logger.error(`Error getting all role progress for ${userId}:`, error);
      return [];
    }
  }
}

export const roleConditionTracker = new RoleConditionTracker();

