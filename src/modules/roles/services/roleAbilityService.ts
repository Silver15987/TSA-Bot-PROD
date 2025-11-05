import { database } from '../../../database/client';
import { RoleType } from '../../../types/database';
import logger from '../../../core/logger';
import { getAbilityDefinition } from '../types/roleDefinitions';
import { roleActionLogger } from './roleActionLogger';

export interface AbilityCheckResult {
  canUse: boolean;
  error?: string;
  cooldownEndsAt?: Date;
}

export interface AbilityExecutionResult {
  success: boolean;
  error?: string;
  message?: string;
  metadata?: Record<string, any>;
}

/**
 * Role Ability Service
 * Handles ability validation, cooldowns, costs, and execution
 */
export class RoleAbilityService {
  /**
   * Check if user can use an ability
   */
  async canUseAbility(
    userId: string,
    guildId: string,
    abilityName: string
  ): Promise<AbilityCheckResult> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        return {
          canUse: false,
          error: 'User not found',
        };
      }

      if (!user.role) {
        return {
          canUse: false,
          error: 'User does not have a role',
        };
      }

      const ability = getAbilityDefinition(user.role, abilityName);
      if (!ability) {
        return {
          canUse: false,
          error: 'Ability not found',
        };
      }

      // Check faction requirement
      if (ability.requiresFaction && !user.currentFaction) {
        return {
          canUse: false,
          error: 'This ability requires faction membership',
        };
      }

      // Check cooldown
      const cooldownCheck = await this.checkCooldown(userId, guildId, abilityName);
      if (!cooldownCheck.canUse) {
        return cooldownCheck;
      }

      // Check cost
      if (ability.cost > 0 && user.coins < ability.cost) {
        return {
          canUse: false,
          error: `Insufficient coins. Required: ${ability.cost}`,
        };
      }

      return {
        canUse: true,
      };
    } catch (error) {
      logger.error(`Error checking ability for ${userId}:`, error);
      return {
        canUse: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check ability cooldown
   */
  async checkCooldown(
    userId: string,
    guildId: string,
    abilityName: string
  ): Promise<AbilityCheckResult> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user || !user.role) {
        return {
          canUse: false,
          error: 'User or role not found',
        };
      }

      const ability = getAbilityDefinition(user.role, abilityName);
      if (!ability) {
        return {
          canUse: false,
          error: 'Ability not found',
        };
      }

      const cooldowns = user.roleCooldowns || [];
      const cooldown = cooldowns.find(c => c.abilityName === abilityName);

      if (cooldown) {
        const now = new Date();
        if (now < cooldown.cooldownEndsAt) {
          return {
            canUse: false,
            error: 'Ability is on cooldown',
            cooldownEndsAt: cooldown.cooldownEndsAt,
          };
        }
      }

      return {
        canUse: true,
      };
    } catch (error) {
      logger.error(`Error checking cooldown for ${userId}:`, error);
      return {
        canUse: false,
        error: 'Error checking cooldown',
      };
    }
  }

  /**
   * Set ability cooldown
   */
  async setCooldown(
    userId: string,
    guildId: string,
    abilityName: string,
    cooldownHours: number
  ): Promise<boolean> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        return false;
      }

      const cooldowns = user.roleCooldowns || [];
      const cooldownEndsAt = new Date(Date.now() + cooldownHours * 60 * 60 * 1000);

      // Remove existing cooldown for this ability
      const filteredCooldowns = cooldowns.filter(c => c.abilityName !== abilityName);
      filteredCooldowns.push({
        abilityName,
        cooldownEndsAt,
      });

      await database.users.updateOne(
        { id: userId, guildId },
        {
          $set: {
            roleCooldowns: filteredCooldowns,
            updatedAt: new Date(),
          },
        }
      );

      return true;
    } catch (error) {
      logger.error(`Error setting cooldown for ${userId}:`, error);
      return false;
    }
  }

  /**
   * Deduct ability cost
   */
  async deductCost(userId: string, guildId: string, cost: number): Promise<boolean> {
    try {
      if (cost <= 0) {
        return true; // No cost
      }

      const result = await database.users.updateOne(
        { id: userId, guildId },
        {
          $inc: { coins: -cost },
          $set: { updatedAt: new Date() },
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      logger.error(`Error deducting cost for ${userId}:`, error);
      return false;
    }
  }

  /**
   * Log ability use
   */
  async logAbilityUse(
    userId: string,
    guildId: string,
    roleType: RoleType,
    abilityName: string,
    success: boolean,
    targetUserId?: string,
    targetFactionId?: string,
    amount?: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    await roleActionLogger.logAction({
      guildId,
      userId,
      roleType,
      abilityName,
      targetUserId,
      targetFactionId,
      success,
      amount,
      metadata,
    });
  }

  /**
   * Calculate success rate with modifiers
   */
  calculateSuccessRate(
    baseRate: number,
    modifiers: {
      items?: number;
      buffs?: number;
      debuffs?: number;
    }
  ): number {
    let rate = baseRate;
    rate += modifiers.items || 0;
    rate += modifiers.buffs || 0;
    rate -= modifiers.debuffs || 0;
    return Math.max(0, Math.min(100, rate)); // Clamp between 0 and 100
  }

  /**
   * Roll for success
   */
  rollSuccess(successRate: number): boolean {
    const roll = Math.random() * 100;
    return roll < successRate;
  }
}

export const roleAbilityService = new RoleAbilityService();

