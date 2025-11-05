import { database } from '../../../database/client';
import { FactionDocument } from '../../../types/database';
import logger from '../../../core/logger';
import { FactionCreationResult } from '../types';

/**
 * Faction Manager
 * Handles database operations for factions
 */
export class FactionManager {
  /**
   * Create a new faction in the database
   */
  async createFaction(
    guildId: string,
    name: string,
    ownerId: string,
    roleId: string,
    channelId: string,
    initialDeposit: number
  ): Promise<FactionCreationResult> {
    try {
      // Generate unique faction ID
      const factionId = this.generateFactionId();

      // Calculate next upkeep date (tomorrow at midnight UTC)
      const nextUpkeepDate = this.calculateNextUpkeepDate();

      const factionDoc: FactionDocument = {
        id: factionId,
        guildId,
        name,
        roleId,
        channelId,
        ownerId,
        officers: [],
        members: [ownerId],
        treasury: initialDeposit,
        totalDeposited: initialDeposit,
        totalWithdrawn: 0,
        coinMultiplier: 1.0, // Default multiplier (no effect)
        nextUpkeepDate,
        upkeepAmount: 1000, // Base upkeep cost (will scale with member count during upkeep processing)
        totalVcTime: 0,
        level: 1,
        totalFactionVcTime: 0,
        totalMessages: 0,
        xp: 0, // Initialize XP
        pendingVcXp: 0, // Initialize pending VC XP accumulator
        membersWhoGaveXp: [ownerId], // Owner gets XP credit
        ledger: [], // Initialize empty ledger
        dailyQuestsCompleted: 0,
        weeklyQuestsCompleted: 0,
        warVictories: 0,
        warLosses: 0,
        warDraws: 0,
        disbanded: false,
        disbandedAt: null,
        disbandedReason: null,
        totalMembersEver: 1,
        peakMemberCount: 1,
        memberHistory: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await database.factions.insertOne(factionDoc);

      // Cache faction multiplier in Redis
      try {
        const { multiplierCacheService } = await import('../../status/services/multiplierCacheService');
        await multiplierCacheService.setFactionMultiplierCache(factionId, guildId, 1.0);
      } catch (error) {
        logger.warn(`Failed to cache faction multiplier for ${factionId}:`, error);
        // Don't fail faction creation if caching fails
      }

      logger.info(`Created faction "${name}" (${factionId}) for guild ${guildId}`);

      return {
        success: true,
        factionId,
        roleId,
        channelId,
      };
    } catch (error) {
      logger.error(`Failed to create faction "${name}":`, error);
      return {
        success: false,
        error: 'Database error occurred while creating faction',
      };
    }
  }

  /**
   * Get faction by ID
   */
  async getFactionById(factionId: string, guildId: string): Promise<FactionDocument | null> {
    try {
      return await database.factions.findOne({ id: factionId, guildId, disbanded: { $ne: true } });
    } catch (error) {
      logger.error(`Failed to get faction ${factionId}:`, error);
      return null;
    }
  }

  /**
   * Get faction by name
   */
  async getFactionByName(name: string, guildId: string): Promise<FactionDocument | null> {
    try {
      return await database.factions.findOne({
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        guildId,
        disbanded: { $ne: true }
      });
    } catch (error) {
      logger.error(`Failed to get faction by name "${name}":`, error);
      return null;
    }
  }

  /**
   * Get user's current faction
   */
  async getUserFaction(userId: string, guildId: string): Promise<FactionDocument | null> {
    try {
      return await database.factions.findOne({
        members: userId,
        guildId,
        disbanded: { $ne: true }
      });
    } catch (error) {
      logger.error(`Failed to get user faction for ${userId}:`, error);
      return null;
    }
  }

  /**
   * Get all factions in a guild
   */
  async getAllFactions(guildId: string): Promise<FactionDocument[]> {
    try {
      return await database.factions.find({ guildId, disbanded: { $ne: true } }).toArray();
    } catch (error) {
      logger.error(`Failed to get all factions for guild ${guildId}:`, error);
      return [];
    }
  }

  /**
   * Check if faction name exists in guild
   */
  async factionNameExists(name: string, guildId: string): Promise<boolean> {
    try {
      const faction = await this.getFactionByName(name, guildId);
      return faction !== null;
    } catch (error) {
      logger.error(`Failed to check if faction name exists "${name}":`, error);
      return false;
    }
  }

  /**
   * Get faction count for a guild
   */
  async getFactionCount(guildId: string): Promise<number> {
    try {
      return await database.factions.countDocuments({ guildId, disbanded: { $ne: true } });
    } catch (error) {
      logger.error(`Failed to get faction count for guild ${guildId}:`, error);
      return 0;
    }
  }

  /**
   * Delete faction from database
   */
  async deleteFaction(factionId: string, guildId: string): Promise<boolean> {
    try {
      const result = await database.factions.deleteOne({ id: factionId, guildId });

      if (result.deletedCount > 0) {
        logger.info(`Deleted faction ${factionId} from guild ${guildId}`);
        return true;
      }

      logger.warn(`Faction ${factionId} not found for deletion`);
      return false;
    } catch (error) {
      logger.error(`Failed to delete faction ${factionId}:`, error);
      return false;
    }
  }

  /**
   * Update faction treasury
   */
  async updateTreasury(
    factionId: string,
    guildId: string,
    amount: number,
    operation: 'deposit' | 'withdraw'
  ): Promise<boolean> {
    try {
      const updateFields: any = {
        $inc: { treasury: amount },
        $set: { updatedAt: new Date() },
      };

      if (operation === 'deposit') {
        updateFields.$inc.totalDeposited = amount;
      } else if (operation === 'withdraw') {
        updateFields.$inc.totalWithdrawn = Math.abs(amount);
      }

      const result = await database.factions.updateOne(
        { id: factionId, guildId },
        updateFields
      );

      return result.modifiedCount > 0;
    } catch (error) {
      logger.error(`Failed to update treasury for faction ${factionId}:`, error);
      return false;
    }
  }

  /**
   * Add member to faction
   */
  async addMember(factionId: string, guildId: string, userId: string): Promise<boolean> {
    try {
      const result = await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $addToSet: { members: userId },
          $set: { updatedAt: new Date() },
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      logger.error(`Failed to add member ${userId} to faction ${factionId}:`, error);
      return false;
    }
  }

  /**
   * Remove member from faction
   */
  async removeMember(factionId: string, guildId: string, userId: string): Promise<boolean> {
    try {
      const result = await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $pull: { members: userId, officers: userId },
          $set: { updatedAt: new Date() },
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      logger.error(`Failed to remove member ${userId} from faction ${factionId}:`, error);
      return false;
    }
  }

  /**
   * Transfer faction ownership
   */
  async transferOwnership(factionId: string, guildId: string, newOwnerId: string): Promise<boolean> {
    try {
      const result = await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $set: {
            ownerId: newOwnerId,
            updatedAt: new Date()
          },
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      logger.error(`Failed to transfer ownership for faction ${factionId}:`, error);
      return false;
    }
  }

  /**
   * Generate unique faction ID
   */
  private generateFactionId(): string {
    return `faction_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Calculate next upkeep date (tomorrow at midnight UTC)
   */
  private calculateNextUpkeepDate(): Date {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow;
  }
}

export const factionManager = new FactionManager();
