import { RoleType, RoleProgressEntry } from '../../../types/database';
import { ROLE_DEFINITIONS } from '../types/roleDefinitions';
import { RoleUnlockConditionDocument } from '../../../types/database';

/**
 * Format role name for display
 */
export function formatRoleName(roleType: RoleType | null): string {
  if (!roleType) {
    return 'No Role';
  }
  return ROLE_DEFINITIONS[roleType].name;
}

/**
 * Format role description
 */
export function formatRoleDescription(roleType: RoleType): string {
  return ROLE_DEFINITIONS[roleType].description;
}

/**
 * Format role progress for display
 */
export function formatRoleProgress(
  progress: RoleProgressEntry | null,
  conditions: RoleUnlockConditionDocument | null
): string {
  if (!progress || !conditions) {
    return 'No progress tracked';
  }

  const lines: string[] = [];
  
  for (const condition of conditions.conditions) {
    if (condition.type === 'faction_deposit') {
      const required = condition.value as number;
      const current = progress.conditions.factionDeposit || 0;
      const percentage = required > 0 ? Math.min(100, (current / required) * 100) : 0;
      lines.push(`**Faction Deposits:** ${current.toLocaleString()} / ${required.toLocaleString()} (${percentage.toFixed(1)}%)`);
    } else if (condition.type === 'coins_spent') {
      const required = condition.value as number;
      const current = progress.conditions.coinsSpent || 0;
      const percentage = required > 0 ? Math.min(100, (current / required) * 100) : 0;
      lines.push(`**Coins Spent:** ${current.toLocaleString()} / ${required.toLocaleString()} (${percentage.toFixed(1)}%)`);
    } else if (condition.type === 'quest') {
      const requiredQuestId = condition.value as string;
      const completedQuests = progress.conditions.questsCompleted || [];
      const completed = completedQuests.includes(requiredQuestId);
      lines.push(`**Quest:** ${requiredQuestId} - ${completed ? '✅ Completed' : '❌ Not Completed'}`);
    }
  }

  return lines.join('\n') || 'No conditions configured';
}

/**
 * Format ability name for display
 */
export function formatAbilityName(abilityName: string): string {
  return abilityName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format cooldown time remaining
 */
export function formatCooldownRemaining(cooldownEndsAt: Date): string {
  const now = new Date();
  const diff = cooldownEndsAt.getTime() - now.getTime();

  if (diff <= 0) {
    return 'Ready';
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Format role emoji (for display)
 */
export function getRoleEmoji(roleType: RoleType): string {
  const emojis: Record<RoleType, string> = {
    guard: '🛡️',
    thief: '🗡️',
    witch: '🔮',
    oracle: '👁️',
    enchanter: '🧙‍♂️',
    merchant: '💰',
  };
  return emojis[roleType] || '❓';
}

