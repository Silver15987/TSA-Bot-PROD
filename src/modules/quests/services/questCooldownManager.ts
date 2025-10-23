import { database } from '../../../database/client';
import { QuestCooldownDocument } from '../../../types/database';
import logger from '../../../core/logger';
import { configManager } from '../../../core/configManager';

/**
 * Quest Cooldown Manager
 * Handles quest cooldown tracking for factions
 */
export class QuestCooldownManager {
  /**
   * Set cooldown for a faction
   */
  async setCooldown(
    factionId: string,
    guildId: string,
    rejectedQuestId: string | null = null
  ): Promise<boolean> {
    try {
      const config = configManager.getConfig(guildId);
      const cooldownHours = config.quests.cooldownHours;
      const cooldownEndsAt = new Date(Date.now() + cooldownHours * 60 * 60 * 1000);

      const existingCooldown = await database.questCooldowns.findOne({ factionId });

      if (existingCooldown) {
        // Update existing cooldown
        await database.questCooldowns.updateOne(
          { factionId },
          {
            $set: {
              cooldownEndsAt,
              lastRejectedQuestId: rejectedQuestId,
              updatedAt: new Date(),
            },
            $inc: {
              rejectionCount: 1,
            },
          }
        );
      } else {
        // Create new cooldown
        const cooldownDoc: QuestCooldownDocument = {
          factionId,
          guildId,
          cooldownEndsAt,
          lastRejectedQuestId: rejectedQuestId,
          rejectionCount: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await database.questCooldowns.insertOne(cooldownDoc);
      }

      logger.info(`Set quest cooldown for faction ${factionId} until ${cooldownEndsAt.toISOString()}`);
      return true;
    } catch (error) {
      logger.error(`Failed to set cooldown for faction ${factionId}:`, error);
      return false;
    }
  }

  /**
   * Check if faction is on cooldown
   */
  async isOnCooldown(factionId: string): Promise<boolean> {
    try {
      const cooldown = await database.questCooldowns.findOne({ factionId });

      if (!cooldown) {
        return false;
      }

      const now = new Date();
      return now < cooldown.cooldownEndsAt;
    } catch (error) {
      logger.error(`Failed to check cooldown for faction ${factionId}:`, error);
      return false;
    }
  }

  /**
   * Get remaining cooldown time in milliseconds
   */
  async getRemainingCooldown(factionId: string): Promise<number> {
    try {
      const cooldown = await database.questCooldowns.findOne({ factionId });

      if (!cooldown) {
        return 0;
      }

      const now = new Date();
      const remaining = cooldown.cooldownEndsAt.getTime() - now.getTime();

      return remaining > 0 ? remaining : 0;
    } catch (error) {
      logger.error(`Failed to get remaining cooldown for faction ${factionId}:`, error);
      return 0;
    }
  }

  /**
   * Clear cooldown for a faction (admin override)
   */
  async clearCooldown(factionId: string): Promise<boolean> {
    try {
      const result = await database.questCooldowns.deleteOne({ factionId });

      if (result.deletedCount > 0) {
        logger.info(`Cleared quest cooldown for faction ${factionId}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Failed to clear cooldown for faction ${factionId}:`, error);
      return false;
    }
  }

  /**
   * Get cooldown info
   */
  async getCooldownInfo(factionId: string): Promise<QuestCooldownDocument | null> {
    try {
      return await database.questCooldowns.findOne({ factionId });
    } catch (error) {
      logger.error(`Failed to get cooldown info for faction ${factionId}:`, error);
      return null;
    }
  }

  /**
   * Clean up expired cooldowns (periodic cleanup)
   */
  async cleanupExpiredCooldowns(): Promise<number> {
    try {
      const now = new Date();
      const result = await database.questCooldowns.deleteMany({
        cooldownEndsAt: { $lt: now },
      });

      if (result.deletedCount > 0) {
        logger.info(`Cleaned up ${result.deletedCount} expired quest cooldowns`);
      }

      return result.deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup expired cooldowns:', error);
      return 0;
    }
  }
}

export const questCooldownManager = new QuestCooldownManager();
