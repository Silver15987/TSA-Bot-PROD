import { QuestDocument } from '../../../types/database';
import { QuestType } from '../types';
import { getDifficultyEmoji, getDifficultyLabel } from './difficultyScaler';
import { formatHoursMinutes } from '../../../utils/timeFormatters';

/**
 * Format quest type for display
 */
export function formatQuestType(type: QuestType): string {
  switch (type) {
    case 'collective_vc_time':
      return 'Collective VC Time';
    case 'treasury_deposit':
      return 'Treasury Deposit';
    case 'member_participation':
      return 'Member Participation';
  }
}

/**
 * Format quest goal value based on type
 */
export function formatQuestGoal(type: QuestType, goal: number): string {
  switch (type) {
    case 'collective_vc_time':
      return formatDuration(goal);
    case 'treasury_deposit':
      return `${goal.toLocaleString()} coins`;
    case 'member_participation':
      return `${goal}% members`;
  }
}

/**
 * Format quest progress value based on type
 */
export function formatQuestProgress(type: QuestType, progress: number): string {
  switch (type) {
    case 'collective_vc_time':
      return formatDuration(progress);
    case 'treasury_deposit':
      return `${progress.toLocaleString()} coins`;
    case 'member_participation':
      return `${Math.floor(progress)}% members`;
  }
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  return formatHoursMinutes(ms);
}

/**
 * Format time remaining until deadline
 */
export function formatTimeRemaining(deadline: Date): string {
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();

  if (diff <= 0) {
    return 'Expired';
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

/**
 * Calculate progress percentage
 */
export function calculateProgressPercentage(current: number, goal: number): number {
  if (goal === 0) return 0;
  return Math.min(100, Math.floor((current / goal) * 100));
}

/**
 * Create progress bar
 */
export function createProgressBar(percentage: number, length: number = 20): string {
  const filled = Math.floor((percentage / 100) * length);
  const empty = length - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percentage}%`;
}

/**
 * Format bonus effect for display
 */
export function formatBonusEffect(bonusEffect: string | null): string {
  if (!bonusEffect) {
    return 'None';
  }

  switch (bonusEffect) {
    case 'coin_multiplier_2x_24h':
      return '✨ 2x coin rate for 24 hours';
    case 'upkeep_forgiven_today':
      return '💰 Upkeep forgiven for today';
    default:
      return bonusEffect;
  }
}

/**
 * Format quest status emoji
 */
export function getQuestStatusEmoji(status: string): string {
  switch (status) {
    case 'template':
      return '📝';
    case 'offered':
      return '📬';
    case 'active':
      return '🟢';
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    case 'rejected':
      return '🚫';
    case 'expired':
      return '⏰';
    default:
      return '❓';
  }
}

/**
 * Get rank emoji for contributor position
 */
export function getRankEmoji(rank: number): string {
  switch (rank) {
    case 1:
      return '🥇';
    case 2:
      return '🥈';
    case 3:
      return '🥉';
    default:
      return `${rank}️⃣`;
  }
}

/**
 * Format quest summary for embed
 */
export function formatQuestSummary(quest: QuestDocument): string {
  const difficultyEmoji = getDifficultyEmoji(quest.difficulty);
  const difficultyLabel = getDifficultyLabel(quest.difficulty);
  const typeLabel = formatQuestType(quest.type);
  const goalText = formatQuestGoal(quest.type, quest.goal);
  const bonusText = formatBonusEffect(quest.bonusEffect);

  return (
    `**${quest.name}**\n` +
    `${difficultyEmoji} Difficulty: ${difficultyLabel}\n` +
    `📋 Type: ${typeLabel}\n` +
    `🎯 Goal: ${goalText}\n` +
    `⏱️ Duration: ${quest.durationHours} hours\n` +
    `✨ Bonus: ${bonusText}`
  );
}
