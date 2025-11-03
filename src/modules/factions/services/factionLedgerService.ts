import { database } from '../../../database/client';
import { FactionLedgerEntry } from '../../../types/database';
import logger from '../../../core/logger';

/**
 * Faction Ledger Service
 * Handles deposit/withdrawal ledger entries with size limits for cost optimization
 */
export class FactionLedgerService {
  private readonly MAX_LEDGER_ENTRIES = 100; // Maximum ledger entries per faction

  /**
   * Add ledger entry to faction
   * Automatically maintains size limit (keeps only last 100 entries)
   * Uses atomic $push with $slice to prevent unbounded document growth
   */
  async addLedgerEntry(
    factionId: string,
    guildId: string,
    userId: string,
    username: string,
    type: 'deposit' | 'withdraw',
    amount: number,
    balanceAfter: number
  ): Promise<boolean> {
    try {
      const ledgerEntry: FactionLedgerEntry = {
        id: `ledger_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
        userId,
        username,
        type,
        amount,
        balanceAfter,
        createdAt: new Date(),
      };

      // Use $push with $slice to maintain size limit atomically
      // This keeps only the last MAX_LEDGER_ENTRIES entries
      const result = await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $push: {
            ledger: {
              $each: [ledgerEntry],
              $slice: -this.MAX_LEDGER_ENTRIES, // Keep only last 100 entries
            },
          },
          $set: { updatedAt: new Date() },
        }
      );

      if (result.modifiedCount > 0) {
        logger.debug(
          `Added ledger entry for faction ${factionId}: ${type} ${amount} coins by ${username}`
        );
        return true;
      }

      logger.warn(`Failed to add ledger entry for faction ${factionId}`);
      return false;
    } catch (error) {
      logger.error(`Error adding ledger entry for faction ${factionId}:`, error);
      return false;
    }
  }

  /**
   * Get ledger entries for a faction
   * Returns entries sorted by creation date (newest first)
   */
  async getLedgerEntries(
    factionId: string,
    guildId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<FactionLedgerEntry[]> {
    try {
      const faction = await database.factions.findOne(
        { id: factionId, guildId },
        { projection: { ledger: 1 } }
      );

      if (!faction || !faction.ledger) {
        return [];
      }

      // Sort by createdAt descending (newest first) and apply pagination
      const sortedLedger = [...faction.ledger].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );

      return sortedLedger.slice(offset, offset + limit);
    } catch (error) {
      logger.error(`Error retrieving ledger entries for faction ${factionId}:`, error);
      return [];
    }
  }

  /**
   * Get total ledger entries count for a faction
   */
  async getLedgerCount(factionId: string, guildId: string): Promise<number> {
    try {
      const faction = await database.factions.findOne(
        { id: factionId, guildId },
        { projection: { ledger: 1 } }
      );

      return faction?.ledger?.length || 0;
    } catch (error) {
      logger.error(`Error getting ledger count for faction ${factionId}:`, error);
      return 0;
    }
  }
}

export const factionLedgerService = new FactionLedgerService();

