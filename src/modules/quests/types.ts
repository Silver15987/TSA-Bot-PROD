/**
 * Quest module types
 */

/**
 * Quest creation result
 */
export interface QuestCreationResult {
  success: boolean;
  questId?: string;
  error?: string;
}

/**
 * Quest operation result
 */
export interface QuestOperationResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Quest validation result
 */
export interface QuestValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Quest progress update
 */
export interface QuestProgressUpdate {
  questId: string;
  userId: string;
  contributionAmount: number; // VC time in ms or coins
  timestamp: Date;
}

/**
 * Quest reward calculation
 */
export interface QuestRewardCalculation {
  userId: string;
  contribution: number;
  rank: number;
  reward: number;
  isTreasury?: boolean;
}

/**
 * Quest contributor info
 */
export interface QuestContributor {
  userId: string;
  contribution: number;
  rank?: number;
  reward?: number;
}

/**
 * Quest template data from modal
 */
export interface QuestTemplateData {
  name: string;
  description: string;
  type: 'collective_vc_time' | 'treasury_deposit' | 'member_participation';
  baseGoal: number;
  durationHours: number;
  treasuryReward: number;
  questXp?: number; // Optional: XP awarded to faction on completion (defaults to 500)
  firstPlaceReward: number;
  secondPlaceReward: number;
  thirdPlaceReward: number;
  participationReward: number;
  bonusEffect: string | null;
}

/**
 * Quest status filter
 */
export type QuestStatus = 'template' | 'offered' | 'active' | 'completed' | 'failed' | 'rejected' | 'expired';

/**
 * Quest type
 */
export type QuestType = 'collective_vc_time' | 'treasury_deposit' | 'member_participation';

/**
 * Quest difficulty
 */
export type QuestDifficulty = 'easy' | 'medium' | 'hard';

/**
 * Bonus effect type
 */
export type BonusEffectType = 'coin_multiplier_2x_24h' | 'upkeep_forgiven_today' | null;
