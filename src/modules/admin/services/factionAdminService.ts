import { database } from '../../../database/client';
import { FactionEconomyAdminResult } from '../types';
import logger from '../../../core/logger';

/**
 * Faction Admin Service
 * Handles admin operations for faction treasury
 */
export class FactionAdminService {
  /**
   * Add coins to a faction's treasury
   */
  async addCoins(
    factionId: string,
    guildId: string,
    amount: number,
    _staffUserId: string
  ): Promise<FactionEconomyAdminResult> {
    try {
      // Validate amount
      if (amount <= 0) {
        return {
          success: false,
          factionId,
          factionName: '',
          amount,
          treasuryBefore: 0,
          treasuryAfter: 0,
          error: 'Amount must be greater than 0',
        };
      }

      // Get faction
      const faction = await database.factions.findOne({ id: factionId, guildId });
      if (!faction) {
        return {
          success: false,
          factionId,
          factionName: '',
          amount,
          treasuryBefore: 0,
          treasuryAfter: 0,
          error: 'Faction not found',
        };
      }

      const treasuryBefore = faction.treasury;

      // Add coins to faction treasury
      const result = await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $inc: {
            treasury: amount,
            totalDeposited: amount,
          },
          $set: { updatedAt: new Date() },
        }
      );

      if (result.modifiedCount === 0) {
        return {
          success: false,
          factionId,
          factionName: faction.name,
          amount,
          treasuryBefore,
          treasuryAfter: treasuryBefore,
          error: 'Failed to update faction treasury',
        };
      }

      const treasuryAfter = treasuryBefore + amount;

      logger.info(`Admin added ${amount} coins to faction ${factionId} (${faction.name}). Treasury: ${treasuryBefore} → ${treasuryAfter}`);

      return {
        success: true,
        factionId,
        factionName: faction.name,
        amount,
        treasuryBefore,
        treasuryAfter,
      };
    } catch (error) {
      logger.error('Error adding coins to faction:', error);
      return {
        success: false,
        factionId,
        factionName: '',
        amount,
        treasuryBefore: 0,
        treasuryAfter: 0,
        error: 'An unexpected error occurred',
      };
    }
  }

  /**
   * Remove coins from a faction's treasury
   */
  async removeCoins(
    factionId: string,
    guildId: string,
    amount: number,
    _staffUserId: string
  ): Promise<FactionEconomyAdminResult> {
    try {
      // Validate amount
      if (amount <= 0) {
        return {
          success: false,
          factionId,
          factionName: '',
          amount,
          treasuryBefore: 0,
          treasuryAfter: 0,
          error: 'Amount must be greater than 0',
        };
      }

      // Get faction
      const faction = await database.factions.findOne({ id: factionId, guildId });
      if (!faction) {
        return {
          success: false,
          factionId,
          factionName: '',
          amount,
          treasuryBefore: 0,
          treasuryAfter: 0,
          error: 'Faction not found',
        };
      }

      const treasuryBefore = faction.treasury;

      // Check if faction has enough coins
      if (treasuryBefore < amount) {
        return {
          success: false,
          factionId,
          factionName: faction.name,
          amount,
          treasuryBefore,
          treasuryAfter: treasuryBefore,
          error: `Faction treasury only has ${treasuryBefore.toLocaleString()} coins`,
        };
      }

      // Remove coins from faction treasury
      const result = await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $inc: {
            treasury: -amount,
            totalWithdrawn: amount,
          },
          $set: { updatedAt: new Date() },
        }
      );

      if (result.modifiedCount === 0) {
        return {
          success: false,
          factionId,
          factionName: faction.name,
          amount,
          treasuryBefore,
          treasuryAfter: treasuryBefore,
          error: 'Failed to update faction treasury',
        };
      }

      const treasuryAfter = treasuryBefore - amount;

      logger.info(`Admin removed ${amount} coins from faction ${factionId} (${faction.name}). Treasury: ${treasuryBefore} → ${treasuryAfter}`);

      return {
        success: true,
        factionId,
        factionName: faction.name,
        amount,
        treasuryBefore,
        treasuryAfter,
      };
    } catch (error) {
      logger.error('Error removing coins from faction:', error);
      return {
        success: false,
        factionId,
        factionName: '',
        amount,
        treasuryBefore: 0,
        treasuryAfter: 0,
        error: 'An unexpected error occurred',
      };
    }
  }

  /**
   * Get faction by role ID
   */
  async getFactionByRoleId(roleId: string, guildId: string): Promise<string | null> {
    try {
      const faction = await database.factions.findOne({ roleId, guildId });
      return faction?.id || null;
    } catch (error) {
      logger.error('Error getting faction by role ID:', error);
      return null;
    }
  }
}

export const factionAdminService = new FactionAdminService();
