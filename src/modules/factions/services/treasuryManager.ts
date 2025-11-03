import { database } from '../../../database/client';
import { factionManager } from './factionManager';
import { factionLedgerService } from './factionLedgerService';
import { TreasuryOperationResult } from '../types';
import logger from '../../../core/logger';

/**
 * Treasury Manager
 * Handles faction treasury operations (deposits only - no withdrawals)
 */
export class TreasuryManager {
  /**
   * Deposit coins into faction treasury
   */
  async depositToTreasury(
    factionId: string,
    guildId: string,
    userId: string,
    amount: number
  ): Promise<TreasuryOperationResult> {
    try {
      // Verify faction exists
      const faction = await factionManager.getFactionById(factionId, guildId);
      if (!faction) {
        return {
          success: false,
          error: 'Faction not found',
        };
      }

      // Verify user is a member
      if (!faction.members.includes(userId)) {
        return {
          success: false,
          error: 'You must be a member of this faction to deposit',
        };
      }

      // Get user data
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        return {
          success: false,
          error: 'User not found',
        };
      }

      // Check if user has sufficient balance
      if (user.coins < amount) {
        return {
          success: false,
          error: `Insufficient balance. You have ${user.coins} coins, but need ${amount} coins.`,
        };
      }

      // Perform atomic operations
      // 1. Deduct from user balance
      const userUpdateResult = await database.users.updateOne(
        { id: userId, guildId },
        {
          $inc: {
            coins: -amount,
            factionCoinsDeposited: amount,
          },
          $set: {
            updatedAt: new Date(),
          },
        }
      );

      if (userUpdateResult.modifiedCount === 0) {
        return {
          success: false,
          error: 'Failed to deduct coins from user balance',
        };
      }

      // 2. Add to faction treasury
      const factionUpdateResult = await factionManager.updateTreasury(
        factionId,
        guildId,
        amount,
        'deposit'
      );

      if (!factionUpdateResult) {
        // Rollback user balance
        await database.users.updateOne(
          { id: userId, guildId },
          {
            $inc: {
              coins: amount,
              factionCoinsDeposited: -amount,
            },
          }
        );

        return {
          success: false,
          error: 'Failed to update faction treasury',
        };
      }

      // 3. Log transaction
      await database.transactions.insertOne({
        id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
        userId,
        type: 'faction_deposit',
        amount: -amount,
        balanceAfter: user.coins - amount,
        metadata: {
          factionId,
          factionName: faction.name,
          depositAmount: amount,
          guildId,
        },
        createdAt: new Date(),
      });

      const newTreasuryBalance = faction.treasury + amount;

      // Add ledger entry
      await factionLedgerService.addLedgerEntry(
        factionId,
        guildId,
        userId,
        user.username,
        'deposit',
        amount,
        newTreasuryBalance
      );

      logger.info(
        `User ${userId} deposited ${amount} coins to faction ${factionId}. New treasury: ${newTreasuryBalance}`
      );

      // Update quest progress for treasury deposit quests
      try {
        const { questProgressTracker } = await import('../../quests/services/questProgressTracker');
        await questProgressTracker.trackTreasuryContribution(userId, guildId, factionId, amount);
      } catch (error) {
        logger.error('Error tracking quest treasury contribution:', error);
      }

      return {
        success: true,
        newBalance: newTreasuryBalance,
      };
    } catch (error) {
      logger.error('Error depositing to treasury:', error);
      return {
        success: false,
        error: 'An error occurred while processing the deposit',
      };
    }
  }

  /**
   * Get faction treasury balance
   */
  async getTreasuryBalance(factionId: string, guildId: string): Promise<number | null> {
    try {
      const faction = await factionManager.getFactionById(factionId, guildId);
      if (!faction) {
        return null;
      }

      return faction.treasury;
    } catch (error) {
      logger.error('Error getting treasury balance:', error);
      return null;
    }
  }

  /**
   * Get user's total deposits to their faction
   */
  async getUserTotalDeposits(userId: string, guildId: string): Promise<number> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        return 0;
      }

      return user.factionCoinsDeposited || 0;
    } catch (error) {
      logger.error('Error getting user total deposits:', error);
      return 0;
    }
  }
}

export const treasuryManager = new TreasuryManager();
