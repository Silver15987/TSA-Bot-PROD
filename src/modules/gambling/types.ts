/**
 * Gambling module types
 */

/**
 * Coinflip result
 */
export interface CoinflipResult {
  won: boolean;
  userChoice: 'heads' | 'tails';
  result: 'heads' | 'tails';
  betAmount: number;
  winnings: number;
  newBalance: number;
}

/**
 * Slots result
 */
export interface SlotsResult {
  won: boolean;
  symbols: string[];
  multiplier: number;
  betAmount: number;
  winnings: number;
  newBalance: number;
  winType?: 'three_of_a_kind' | 'two_of_a_kind' | 'jackpot';
}

/**
 * Game validation result
 */
export interface GameValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Gambling statistics
 */
export interface GamblingStats {
  gamesPlayed: number;
  totalWagered: number;
  totalWon: number;
  biggestWin: number;
  biggestLoss: number;
  coinflipGames: number;
  coinflipWins: number;
  slotsGames: number;
  slotsWins: number;
}
