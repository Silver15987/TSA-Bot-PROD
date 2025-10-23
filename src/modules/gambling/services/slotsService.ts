import { database } from '../../../database/client';
import { SlotsResult, GameValidationResult } from '../types';
import logger from '../../../core/logger';

/**
 * Slots Service
 * Handles slot machine gambling game logic
 */
export class SlotsService {
  // Slot symbols with their weights (rarity)
  private readonly symbols = [
    { symbol: '🍒', weight: 40, name: 'Cherry' },      // Common
    { symbol: '🍋', weight: 35, name: 'Lemon' },       // Common
    { symbol: '🍊', weight: 30, name: 'Orange' },      // Uncommon
    { symbol: '🍉', weight: 25, name: 'Watermelon' },  // Uncommon
    { symbol: '🍇', weight: 20, name: 'Grapes' },      // Rare
    { symbol: '⭐', weight: 15, name: 'Star' },        // Rare
    { symbol: '💎', weight: 10, name: 'Diamond' },     // Very Rare
    { symbol: '7️⃣', weight: 5, name: 'Seven' },        // Ultra Rare (Jackpot)
  ];

  /**
   * Validate bet amount for slots
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
   * Play slots game
   */
  async playSlots(
    userId: string,
    guildId: string,
    betAmount: number,
    houseEdge: number
  ): Promise<SlotsResult | null> {
    try {
      // Get user
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        logger.error(`User ${userId} not found for slots`);
        return null;
      }

      // Spin the slots
      const symbols = this.spinSlots(houseEdge);

      // Calculate result
      const result = this.calculateWinnings(symbols, betAmount);

      // Calculate new balance
      const winnings = result.won ? result.winnings : -betAmount;
      const newBalance = user.coins + winnings;

      // Update user balance and stats
      await this.updateUserAfterGame(userId, guildId, result.won, betAmount, result.winnings, newBalance);

      // Log transaction
      await database.transactions.insertOne({
        id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
        userId,
        type: 'slots',
        amount: winnings,
        balanceAfter: newBalance,
        metadata: {
          won: result.won,
          betAmount,
          symbols,
          multiplier: result.multiplier,
          winnings: result.winnings,
          winType: result.winType,
          guildId,
        },
        createdAt: new Date(),
      });

      logger.info(
        `Slots: User ${userId} bet ${betAmount}, got ${symbols.join(' ')}. ${result.won ? `WON ${result.winnings}` : 'LOST'} coins`
      );

      return {
        ...result,
        symbols,
        betAmount,
        newBalance,
      };
    } catch (error) {
      logger.error('Error playing slots:', error);
      return null;
    }
  }

  /**
   * Spin the slots (3 reels)
   */
  private spinSlots(houseEdge: number): string[] {
    const result: string[] = [];

    for (let i = 0; i < 3; i++) {
      result.push(this.getRandomSymbol(houseEdge));
    }

    return result;
  }

  /**
   * Get random symbol based on weights with house edge
   */
  private getRandomSymbol(houseEdge: number): string {
    // Calculate total weight
    const totalWeight = this.symbols.reduce((sum, s) => sum + s.weight, 0);

    // Adjust for house edge (slightly favor common symbols)
    const adjustedRandom = Math.random() * totalWeight * (1 + houseEdge);

    let cumulativeWeight = 0;
    for (const symbolData of this.symbols) {
      cumulativeWeight += symbolData.weight;
      if (adjustedRandom <= cumulativeWeight) {
        return symbolData.symbol;
      }
    }

    // Fallback to most common symbol
    return this.symbols[0].symbol;
  }

  /**
   * Calculate winnings based on symbols
   */
  private calculateWinnings(
    symbols: string[],
    betAmount: number
  ): { won: boolean; winnings: number; multiplier: number; winType?: 'three_of_a_kind' | 'two_of_a_kind' | 'jackpot' } {
    const [s1, s2, s3] = symbols;

    // Three of a kind
    if (s1 === s2 && s2 === s3) {
      // Jackpot (7️⃣7️⃣7️⃣)
      if (s1 === '7️⃣') {
        return {
          won: true,
          winnings: betAmount * 100, // 100x multiplier
          multiplier: 100,
          winType: 'jackpot',
        };
      }

      // Diamond (💎💎💎)
      if (s1 === '💎') {
        return {
          won: true,
          winnings: betAmount * 50, // 50x multiplier
          multiplier: 50,
          winType: 'three_of_a_kind',
        };
      }

      // Star (⭐⭐⭐)
      if (s1 === '⭐') {
        return {
          won: true,
          winnings: betAmount * 25, // 25x multiplier
          multiplier: 25,
          winType: 'three_of_a_kind',
        };
      }

      // Grapes (🍇🍇🍇)
      if (s1 === '🍇') {
        return {
          won: true,
          winnings: betAmount * 15, // 15x multiplier
          multiplier: 15,
          winType: 'three_of_a_kind',
        };
      }

      // Watermelon (🍉🍉🍉)
      if (s1 === '🍉') {
        return {
          won: true,
          winnings: betAmount * 10, // 10x multiplier
          multiplier: 10,
          winType: 'three_of_a_kind',
        };
      }

      // Orange (🍊🍊🍊)
      if (s1 === '🍊') {
        return {
          won: true,
          winnings: betAmount * 7, // 7x multiplier
          multiplier: 7,
          winType: 'three_of_a_kind',
        };
      }

      // Lemon (🍋🍋🍋)
      if (s1 === '🍋') {
        return {
          won: true,
          winnings: betAmount * 5, // 5x multiplier
          multiplier: 5,
          winType: 'three_of_a_kind',
        };
      }

      // Cherry (🍒🍒🍒)
      if (s1 === '🍒') {
        return {
          won: true,
          winnings: betAmount * 3, // 3x multiplier
          multiplier: 3,
          winType: 'three_of_a_kind',
        };
      }
    }

    // Two of a kind (smaller payout)
    if (s1 === s2 || s2 === s3 || s1 === s3) {
      const matchedSymbol = s1 === s2 ? s1 : (s2 === s3 ? s2 : s1);

      // Only high-value symbols pay on two matches
      if (matchedSymbol === '7️⃣' || matchedSymbol === '💎' || matchedSymbol === '⭐') {
        return {
          won: true,
          winnings: betAmount * 2, // 2x multiplier
          multiplier: 2,
          winType: 'two_of_a_kind',
        };
      }
    }

    // No match - lose bet
    return {
      won: false,
      winnings: 0,
      multiplier: 0,
    };
  }

  /**
   * Update user balance and gambling stats after game
   */
  private async updateUserAfterGame(
    userId: string,
    guildId: string,
    won: boolean,
    betAmount: number,
    winnings: number,
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
        'gamblingStats.slotsGames': 1,
      },
    };

    if (won) {
      updateFields.$inc['gamblingStats.totalWon'] = winnings;
      updateFields.$inc['gamblingStats.slotsWins'] = 1;

      // Update biggest win if applicable
      updateFields.$max = {
        'gamblingStats.biggestWin': winnings,
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

export const slotsService = new SlotsService();
