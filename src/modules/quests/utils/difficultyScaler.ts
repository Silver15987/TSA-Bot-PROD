import { QuestDifficulty, QuestType } from '../types';
import { configManager } from '../../../core/configManager';

/**
 * Calculate quest difficulty based on faction size
 */
export function calculateDifficulty(memberCount: number, guildId: string): QuestDifficulty {
  const config = configManager.getConfig(guildId);
  const scaling = config.quests.difficultyScaling;

  if (memberCount <= scaling.easy.maxMembers) {
    return 'easy';
  } else if (memberCount <= scaling.medium.maxMembers) {
    return 'medium';
  } else {
    return 'hard';
  }
}

/**
 * Get difficulty multiplier for quest type
 */
export function getDifficultyMultiplier(
  difficulty: QuestDifficulty,
  questType: QuestType,
  guildId: string
): number {
  const config = configManager.getConfig(guildId);
  const scaling = config.quests.difficultyScaling;

  if (questType === 'collective_vc_time') {
    switch (difficulty) {
      case 'easy':
        return scaling.easy.vcTimeMultiplier;
      case 'medium':
        return scaling.medium.vcTimeMultiplier;
      case 'hard':
        return scaling.hard.vcTimeMultiplier;
    }
  } else if (questType === 'treasury_deposit' || questType === 'member_participation') {
    switch (difficulty) {
      case 'easy':
        return scaling.easy.coinsMultiplier;
      case 'medium':
        return scaling.medium.coinsMultiplier;
      case 'hard':
        return scaling.hard.coinsMultiplier;
    }
  }

  return 1.0;
}

/**
 * Scale quest goal based on difficulty
 */
export function scaleQuestGoal(
  baseGoal: number,
  difficulty: QuestDifficulty,
  questType: QuestType,
  guildId: string
): number {
  const multiplier = getDifficultyMultiplier(difficulty, questType, guildId);
  return Math.floor(baseGoal * multiplier);
}

/**
 * Get difficulty emoji
 */
export function getDifficultyEmoji(difficulty: QuestDifficulty): string {
  switch (difficulty) {
    case 'easy':
      return '🟢';
    case 'medium':
      return '🟡';
    case 'hard':
      return '🔴';
  }
}

/**
 * Get difficulty label
 */
export function getDifficultyLabel(difficulty: QuestDifficulty): string {
  switch (difficulty) {
    case 'easy':
      return 'Easy';
    case 'medium':
      return 'Medium';
    case 'hard':
      return 'Hard';
  }
}
