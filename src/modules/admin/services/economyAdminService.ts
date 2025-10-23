import { database } from '../../../database/client';
import { UserEconomyAdminResult } from '../types';
import logger from '../../../core/logger';

/**
 * Economy Admin Service
 * Handles admin operations for user coin balances
 */
export class EconomyAdminService {
  /**
   * Add coins to a user's balance
   */
  async addCoins(
    userId: string,
    guildId: string,
    amount: number,
    staffUserId: string
  ): Promise<UserEconomyAdminResult> {
    try {
      // Validate amount
      if (amount <= 0) {
        return {
          success: false,
          userId,
          username: '',
          amount,
          balanceBefore: 0,
          balanceAfter: 0,
          error: 'Amount must be greater than 0',
        };
      }

      // Get user
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        return {
          success: false,
          userId,
          username: '',
          amount,
          balanceBefore: 0,
          balanceAfter: 0,
          error: 'User not found in database',
        };
      }

      const balanceBefore = user.coins;

      // Add coins to user
      const result = await database.users.updateOne(
        { id: userId, guildId },
        {
          $inc: { coins: amount },
          $set: { updatedAt: new Date() },
        }
      );

      if (result.modifiedCount === 0) {
        return {
          success: false,
          userId,
          username: user.username,
          amount,
          balanceBefore,
          balanceAfter: balanceBefore,
          error: 'Failed to update user balance',
        };
      }

      const balanceAfter = balanceBefore + amount;

      // Log transaction
      await this.logTransaction(
        userId,
        guildId,
        'admin_add',
        amount,
        balanceAfter,
        staffUserId
      );

      logger.info(`Admin added ${amount} coins to user ${userId} (${user.username}). Balance: ${balanceBefore} → ${balanceAfter}`);

      return {
        success: true,
        userId,
        username: user.username,
        amount,
        balanceBefore,
        balanceAfter,
      };
    } catch (error) {
      logger.error('Error adding coins to user:', error);
      return {
        success: false,
        userId,
        username: '',
        amount,
        balanceBefore: 0,
        balanceAfter: 0,
        error: 'An unexpected error occurred',
      };
    }
  }

  /**
   * Remove coins from a user's balance
   */
  async removeCoins(
    userId: string,
    guildId: string,
    amount: number,
    staffUserId: string
  ): Promise<UserEconomyAdminResult> {
    try {
      // Validate amount
      if (amount <= 0) {
        return {
          success: false,
          userId,
          username: '',
          amount,
          balanceBefore: 0,
          balanceAfter: 0,
          error: 'Amount must be greater than 0',
        };
      }

      // Get user
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        return {
          success: false,
          userId,
          username: '',
          amount,
          balanceBefore: 0,
          balanceAfter: 0,
          error: 'User not found in database',
        };
      }

      const balanceBefore = user.coins;

      // Check if user has enough coins
      if (balanceBefore < amount) {
        return {
          success: false,
          userId,
          username: user.username,
          amount,
          balanceBefore,
          balanceAfter: balanceBefore,
          error: `User only has ${balanceBefore.toLocaleString()} coins`,
        };
      }

      // Remove coins from user
      const result = await database.users.updateOne(
        { id: userId, guildId },
        {
          $inc: { coins: -amount },
          $set: { updatedAt: new Date() },
        }
      );

      if (result.modifiedCount === 0) {
        return {
          success: false,
          userId,
          username: user.username,
          amount,
          balanceBefore,
          balanceAfter: balanceBefore,
          error: 'Failed to update user balance',
        };
      }

      const balanceAfter = balanceBefore - amount;

      // Log transaction
      await this.logTransaction(
        userId,
        guildId,
        'admin_remove',
        -amount,
        balanceAfter,
        staffUserId
      );

      logger.info(`Admin removed ${amount} coins from user ${userId} (${user.username}). Balance: ${balanceBefore} → ${balanceAfter}`);

      return {
        success: true,
        userId,
        username: user.username,
        amount,
        balanceBefore,
        balanceAfter,
      };
    } catch (error) {
      logger.error('Error removing coins from user:', error);
      return {
        success: false,
        userId,
        username: '',
        amount,
        balanceBefore: 0,
        balanceAfter: 0,
        error: 'An unexpected error occurred',
      };
    }
  }

  /**
   * Log transaction to database
   */
  private async logTransaction(
    userId: string,
    guildId: string,
    type: 'admin_add' | 'admin_remove',
    amount: number,
    balanceAfter: number,
    staffUserId: string
  ): Promise<void> {
    try {
      await database.transactions.insertOne({
        id: `${Date.now()}-${userId}-${type}`,
        userId,
        type,
        amount,
        balanceAfter,
        metadata: {
          guildId,
          staffUserId,
          timestamp: new Date(),
        },
        createdAt: new Date(),
      });
    } catch (error) {
      logger.error('Error logging transaction:', error);
    }
  }
}

export const economyAdminService = new EconomyAdminService();
