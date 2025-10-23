import { QuestDocument, FactionDocument } from '../../../types/database';
import { QuestValidationResult, QuestTemplateData } from '../types';
import { factionManager } from '../../factions/services/factionManager';
import logger from '../../../core/logger';

/**
 * Quest Validators
 * Validation logic for quest operations
 */
export class QuestValidators {
  /**
   * Validate quest template data
   */
  validateQuestTemplate(data: QuestTemplateData): QuestValidationResult {
    // Validate name
    if (!data.name || data.name.trim().length === 0) {
      return { valid: false, error: 'Quest name is required' };
    }

    if (data.name.length > 100) {
      return { valid: false, error: 'Quest name must be 100 characters or less' };
    }

    // Validate description
    if (!data.description || data.description.trim().length === 0) {
      return { valid: false, error: 'Quest description is required' };
    }

    if (data.description.length > 500) {
      return { valid: false, error: 'Quest description must be 500 characters or less' };
    }

    // Validate base goal
    if (data.baseGoal <= 0) {
      return { valid: false, error: 'Quest goal must be greater than 0' };
    }

    // Validate duration
    if (data.durationHours <= 0) {
      return { valid: false, error: 'Quest duration must be greater than 0 hours' };
    }

    if (data.durationHours > 168) {
      // Max 1 week
      return { valid: false, error: 'Quest duration must be 168 hours (1 week) or less' };
    }

    // Validate rewards
    if (data.treasuryReward < 0) {
      return { valid: false, error: 'Treasury reward cannot be negative' };
    }

    if (data.firstPlaceReward < 0 || data.secondPlaceReward < 0 || data.thirdPlaceReward < 0) {
      return { valid: false, error: 'Top contributor rewards cannot be negative' };
    }

    if (data.participationReward < 0) {
      return { valid: false, error: 'Participation reward cannot be negative' };
    }

    // Validate bonus effect
    const validBonusEffects = ['coin_multiplier_2x_24h', 'upkeep_forgiven_today', null, ''];
    if (data.bonusEffect && !validBonusEffects.includes(data.bonusEffect)) {
      return { valid: false, error: 'Invalid bonus effect type' };
    }

    return { valid: true };
  }

  /**
   * Check if user can accept quest (warden or overseer)
   */
  async canAcceptQuest(
    userId: string,
    faction: FactionDocument
  ): Promise<QuestValidationResult> {
    // Check if user is owner
    if (faction.ownerId === userId) {
      return { valid: true };
    }

    // Check if user is officer
    if (faction.officers.includes(userId)) {
      return { valid: true };
    }

    return {
      valid: false,
      error: 'Only faction Wardens and Overseers can accept quests',
    };
  }

  /**
   * Validate quest can be accepted
   */
  async validateQuestAcceptance(
    quest: QuestDocument,
    factionId: string,
    _guildId: string
  ): Promise<QuestValidationResult> {
    // Check quest status
    if (quest.status !== 'offered') {
      return {
        valid: false,
        error: 'This quest is not available for acceptance',
      };
    }

    // Check if quest belongs to faction
    if (quest.factionId !== factionId) {
      return {
        valid: false,
        error: 'This quest is not assigned to your faction',
      };
    }

    // Check acceptance deadline
    if (quest.acceptanceDeadline && new Date() > quest.acceptanceDeadline) {
      return {
        valid: false,
        error: 'The acceptance window for this quest has expired',
      };
    }

    return { valid: true };
  }

  /**
   * Validate quest progress update
   */
  validateProgressUpdate(
    quest: QuestDocument,
    contributionAmount: number
  ): QuestValidationResult {
    // Check quest is active
    if (quest.status !== 'active') {
      return {
        valid: false,
        error: 'Quest is not active',
      };
    }

    // Check contribution is valid
    if (contributionAmount <= 0) {
      return {
        valid: false,
        error: 'Contribution amount must be greater than 0',
      };
    }

    // Check quest deadline hasn't passed
    if (quest.questDeadline && new Date() > quest.questDeadline) {
      return {
        valid: false,
        error: 'Quest deadline has passed',
      };
    }

    return { valid: true };
  }

  /**
   * Check if faction can receive a new quest
   */
  async canReceiveQuest(factionId: string, guildId: string): Promise<QuestValidationResult> {
    try {
      // Check if faction exists and is not disbanded
      const faction = await factionManager.getFactionById(factionId, guildId);

      if (!faction) {
        return {
          valid: false,
          error: 'Faction not found',
        };
      }

      if (faction.disbanded) {
        return {
          valid: false,
          error: 'Faction is disbanded',
        };
      }

      return { valid: true };
    } catch (error) {
      logger.error(`Error validating faction for quest ${factionId}:`, error);
      return {
        valid: false,
        error: 'Error validating faction',
      };
    }
  }
}

export const questValidators = new QuestValidators();
