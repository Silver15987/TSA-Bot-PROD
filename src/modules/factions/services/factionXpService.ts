import { database } from '../../../database/client';
import logger from '../../../core/logger';

/**
 * Faction XP Service
 * Handles XP calculation, level calculation, and level up logic
 * Optimized for atomic operations to minimize database costs
 */
export class FactionXpService {
  private readonly BASE_XP = 100; // Base XP for level 1
  private readonly XP_EXPONENT = 1.15; // Exponential growth rate
  private readonly MAX_LEVEL = 100; // Maximum faction level
  private readonly XP_PER_HOUR = 100; // XP per hour of VC time

  /**
   * Calculate level from total XP
   * Pure function - no database access
   */
  calculateLevel(xp: number): number {
    if (xp < this.BASE_XP) {
      return 1;
    }

    let level = 1;
    let requiredXp = this.BASE_XP;
    let totalXpRequired = 0;

    while (level < this.MAX_LEVEL) {
      totalXpRequired += requiredXp;

      if (xp < totalXpRequired) {
        return level;
      }

      level++;
      requiredXp = Math.floor(this.BASE_XP * Math.pow(this.XP_EXPONENT, level - 1));
    }

    return this.MAX_LEVEL;
  }

  /**
   * Calculate total XP required for a specific level
   * Pure function - no database access
   */
  calculateXpForLevel(targetLevel: number): number {
    if (targetLevel <= 1) {
      return 0;
    }

    if (targetLevel > this.MAX_LEVEL) {
      targetLevel = this.MAX_LEVEL;
    }

    let totalXp = 0;
    for (let level = 1; level < targetLevel; level++) {
      const xpForThisLevel = Math.floor(this.BASE_XP * Math.pow(this.XP_EXPONENT, level - 1));
      totalXp += xpForThisLevel;
    }

    return totalXp;
  }

  /**
   * Calculate XP required for next level from current XP
   * Pure function - no database access
   */
  calculateXpForNextLevel(currentXp: number): number {
    const currentLevel = this.calculateLevel(currentXp);
    if (currentLevel >= this.MAX_LEVEL) {
      return 0; // Already at max level
    }

    const xpForNextLevel = this.calculateXpForLevel(currentLevel + 1);
    return Math.max(0, xpForNextLevel - currentXp);
  }

  /**
   * Add XP to faction atomically and check for level up
   * Uses atomic $inc operation to minimize database costs
   */
  async addXp(
    factionId: string,
    guildId: string,
    amount: number,
    source: 'quest_completion' | 'member_join' | 'vc_hours'
  ): Promise<{ success: boolean; newLevel?: number; leveledUp?: boolean }> {
    try {
      if (amount <= 0) {
        logger.warn(`Invalid XP amount ${amount} for faction ${factionId}`);
        return { success: false };
      }

      // Get current faction state to check level before update
      const factionBefore = await database.factions.findOne({ id: factionId, guildId });
      if (!factionBefore) {
        logger.error(`Faction ${factionId} not found when adding XP`);
        return { success: false };
      }

      const oldLevel = factionBefore.level || 1;
      const oldXp = factionBefore.xp || 0;

      // Add XP atomically using $inc
      const updateResult = await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $inc: { xp: amount },
          $set: { updatedAt: new Date() },
        }
      );

      if (updateResult.modifiedCount === 0) {
        logger.warn(`Failed to update XP for faction ${factionId}`);
        return { success: false };
      }

      // Get updated faction to check new level
      const factionAfter = await database.factions.findOne({ id: factionId, guildId });
      if (!factionAfter) {
        logger.error(`Faction ${factionId} not found after XP update`);
        return { success: false };
      }

      const newXp = factionAfter.xp || 0;
      const newLevel = this.calculateLevel(newXp);

      // Check if level increased
      if (newLevel > oldLevel) {
        // Update level atomically
        await database.factions.updateOne(
          { id: factionId, guildId },
          {
            $set: {
              level: newLevel,
              updatedAt: new Date(),
            },
          }
        );

        logger.info(
          `Faction ${factionId} leveled up! Level ${oldLevel} → ${newLevel} (XP: ${oldXp} → ${newXp}, source: ${source})`
        );

        return {
          success: true,
          newLevel,
          leveledUp: true,
        };
      }

      logger.debug(
        `Added ${amount} XP to faction ${factionId} (${oldXp} → ${newXp}, level: ${oldLevel}, source: ${source})`
      );

      return {
        success: true,
        newLevel: oldLevel,
        leveledUp: false,
      };
    } catch (error) {
      logger.error(`Error adding XP to faction ${factionId}:`, error);
      return { success: false };
    }
  }

  /**
   * Convert VC hours to XP
   * Pure function - no database access
   */
  convertVcHoursToXp(vcTimeMs: number): number {
    const hours = Math.floor(vcTimeMs / 3600000); // Convert ms to hours
    return hours * this.XP_PER_HOUR;
  }

  /**
   * Batch convert pending VC XP and add to faction
   * Called periodically to convert accumulated VC time to XP
   */
  async processPendingVcXp(factionId: string, guildId: string): Promise<void> {
    try {
      const faction = await database.factions.findOne({ id: factionId, guildId });
      if (!faction) {
        logger.error(`Faction ${factionId} not found when processing pending VC XP`);
        return;
      }

      const pendingVcXp = faction.pendingVcXp || 0;
      if (pendingVcXp < 3600000) {
        // Less than 1 hour, don't convert yet
        return;
      }

      // Calculate XP to add
      const xpToAdd = this.convertVcHoursToXp(pendingVcXp);
      const hoursUsed = Math.floor(pendingVcXp / 3600000);
      const remainingMs = pendingVcXp % 3600000; // Keep remainder for next batch

      // Atomically add XP and reset pending VC XP
      await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $inc: {
            xp: xpToAdd,
            pendingVcXp: -pendingVcXp + remainingMs, // Reset to remainder
          },
          $set: { updatedAt: new Date() },
        }
      );

      logger.debug(
        `Converted ${hoursUsed} hours of VC time to ${xpToAdd} XP for faction ${factionId} (remaining: ${remainingMs}ms)`
      );

      // Check for level up
      const updatedFaction = await database.factions.findOne({ id: factionId, guildId });
      if (updatedFaction) {
        const oldLevel = faction.level || 1;
        const newXp = updatedFaction.xp || 0;
        const newLevel = this.calculateLevel(newXp);

        if (newLevel > oldLevel) {
          await database.factions.updateOne(
            { id: factionId, guildId },
            {
              $set: {
                level: newLevel,
                updatedAt: new Date(),
              },
            }
          );

          logger.info(
            `Faction ${factionId} leveled up from VC XP! Level ${oldLevel} → ${newLevel}`
          );
        }
      }
    } catch (error) {
      logger.error(`Error processing pending VC XP for faction ${factionId}:`, error);
    }
  }

  /**
   * Get XP per hour constant
   */
  getXpPerHour(): number {
    return this.XP_PER_HOUR;
  }

  /**
   * Get max level constant
   */
  getMaxLevel(): number {
    return this.MAX_LEVEL;
  }
}

export const factionXpService = new FactionXpService();

