import { database } from '../../../database/client';
import { CoinflipResult, GameValidationResult } from '../types';
import logger from '../../../core/logger';

/**
 * Coinflip Service
 * Handles coinflip gambling game logic
 */
export class CoinflipService {
  /**
   * Validate bet amount for coinflip
   */
  validateBet(
    amount: number,
    userBalance: number,
    minBet: number,
    maxBet: number
  ): GameValidationResult {
    if (amount < 1) {
      return {
        valid: false,
        error: 'Bet amount must be at least 1 coin',
      };
    }

    if (amount < minBet) {
      return {
        valid: false,
        error: `Minimum bet is ${minBet.toLocaleString()} coins`,
      };
    }

    if (amount > maxBet) {
      return {
        valid: false,
        error: `Maximum bet is ${maxBet.toLocaleString()} coins`,
      };
    }

    if (amount > userBalance) {
      return {
        valid: false,
        error: `Insufficient balance. You have ${userBalance.toLocaleString()} coins`,
      };
    }

    return { valid: true };
  }

  /**
   * Play coinflip game
   */
  async playCoinflip(
    userId: string,
    guildId: string,
    betAmount: number,
    userChoice: 'heads' | 'tails',
    houseEdge: number
  ): Promise<CoinflipResult | null> {
    try {
      // Get user
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        logger.error(`User ${userId} not found for coinflip`);
        return null;
      }

      // Flip the coin (50/50 with house edge)
      const result = this.flipCoin(houseEdge);
      const won = result === userChoice;

      // Calculate winnings/losses
      const winnings = won ? betAmount : -betAmount;
      const newBalance = user.coins + winnings;

      // Update user balance and stats
      await this.updateUserAfterGame(userId, guildId, won, betAmount, winnings, newBalance);

      // Log transaction
      await database.transactions.insertOne({
        id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
        userId,
        type: 'coinflip',
        amount: winnings,
        balanceAfter: newBalance,
        metadata: {
          won,
          betAmount,
          userChoice,
          result,
          guildId,
        },
        createdAt: new Date(),
      });

      logger.info(
        `Coinflip: User ${userId} bet ${betAmount} on ${userChoice}, result was ${result}. ${won ? 'WON' : 'LOST'} ${Math.abs(winnings)} coins`
      );

      return {
        won,
        userChoice,
        result,
        betAmount,
        winnings: won ? betAmount : 0,
        newBalance,
      };
    } catch (error) {
      logger.error('Error playing coinflip:', error);
      return null;
    }
  }

  /**
   * Flip the coin with house edge consideration
   */
  private flipCoin(houseEdge: number): 'heads' | 'tails' {
    // House edge reduces player win chance slightly
    // Example: 2% house edge = 49% win chance instead of 50%
    const random = Math.random();
    const winChance = 0.5 - houseEdge / 2;

    return random < winChance ? 'heads' : 'tails';
  }

  /**
   * Update user balance and gambling stats after game
   */
  private async updateUserAfterGame(
    userId: string,
    guildId: string,
    won: boolean,
    betAmount: number,
    _winnings: number,
    newBalance: number
  ): Promise<void> {
    const updateFields: any = {
      $set: {
        coins: newBalance,
        updatedAt: new Date(),
      },
      $inc: {
        'gamblingStats.gamesPlayed': 1,
        'gamblingStats.totalWagered': betAmount,
        'gamblingStats.coinflipGames': 1,
      },
    };

    if (won) {
      updateFields.$inc['gamblingStats.totalWon'] = betAmount;
      updateFields.$inc['gamblingStats.coinflipWins'] = 1;

      // Update biggest win if applicable
      updateFields.$max = {
        'gamblingStats.biggestWin': betAmount,
      };
    } else {
      // Update biggest loss if applicable
      updateFields.$max = {
        'gamblingStats.biggestLoss': betAmount,
      };
    }

    await database.users.updateOne({ id: userId, guildId }, updateFields, { upsert: false });
  }
}

export const coinflipService = new CoinflipService();
