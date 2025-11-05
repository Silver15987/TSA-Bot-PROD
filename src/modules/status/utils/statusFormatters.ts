import { StatusEntry, ItemEntry } from '../../../types/database';

/**
 * Status Formatters
 * Utility functions for formatting status displays in Discord embeds
 */

/**
 * Format expiration time as Discord timestamp
 */
export function formatExpirationTime(expiresAt: Date | null): string {
  if (!expiresAt) {
    return 'Permanent';
  }

  const timestamp = Math.floor(new Date(expiresAt).getTime() / 1000);
  return `<t:${timestamp}:R>`;
}

/**
 * Format multiplier with 2 decimal places
 */
export function formatMultiplier(multiplier: number): string {
  return `${multiplier.toFixed(2)}x`;
}

/**
 * Get multiplier color (green > 1.0, yellow = 1.0, red < 1.0)
 */
export function getMultiplierColor(multiplier: number): number {
  if (multiplier > 1.0) {
    return 0x00ff00; // Green
  } else if (multiplier < 1.0) {
    return 0xff0000; // Red
  } else {
    return 0xffff00; // Yellow
  }
}

/**
 * Get status type emoji
 */
export function getStatusTypeEmoji(type: 'buff' | 'debuff' | 'status'): string {
  switch (type) {
    case 'buff':
      return '✨';
    case 'debuff':
      return '🛡️';
    case 'status':
      return '📌';
    default:
      return '•';
  }
}

/**
 * Get source label
 */
export function getSourceLabel(source: 'quest' | 'item' | 'admin' | 'system'): string {
  switch (source) {
    case 'quest':
      return 'Quest Reward';
    case 'item':
      return 'Item';
    case 'admin':
      return 'Admin';
    case 'system':
      return 'System';
    default:
      return 'Unknown';
  }
}

/**
 * Group statuses by type
 */
export function groupStatusesByType(statuses: StatusEntry[]): {
  buffs: StatusEntry[];
  debuffs: StatusEntry[];
  statuses: StatusEntry[];
} {
  return {
    buffs: statuses.filter(s => s.type === 'buff'),
    debuffs: statuses.filter(s => s.type === 'debuff'),
    statuses: statuses.filter(s => s.type === 'status'),
  };
}

/**
 * Sort statuses by expiration (soonest first) or multiplier (highest first)
 */
export function sortStatuses(statuses: StatusEntry[], sortBy: 'expiration' | 'multiplier' = 'expiration'): StatusEntry[] {
  const sorted = [...statuses];
  
  if (sortBy === 'expiration') {
    return sorted.sort((a, b) => {
      if (!a.expiresAt && !b.expiresAt) return 0;
      if (!a.expiresAt) return 1; // Permanent statuses last
      if (!b.expiresAt) return -1;
      return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
    });
  } else {
    return sorted.sort((a, b) => b.multiplier - a.multiplier);
  }
}

/**
 * Format status entry for display
 */
export function formatStatusEntry(status: StatusEntry): string {
  const emoji = getStatusTypeEmoji(status.type);
  const source = getSourceLabel(status.source);
  const multiplier = formatMultiplier(status.multiplier);
  const expiration = formatExpirationTime(status.expiresAt);

  return `${emoji} ${status.name} (${source})\n` +
    `  Multiplier: ${multiplier}\n` +
    `  Expires: ${expiration}`;
}

/**
 * Format item entry for display
 */
export function formatItemEntry(item: ItemEntry): string {
  const multiplier = formatMultiplier(item.multiplier);
  const expiration = formatExpirationTime(item.expiresAt);

  return `• ${item.itemId}\n` +
    `  Multiplier: ${multiplier}\n` +
    `  Expires: ${expiration}`;
}

/**
 * Format status list for embed field (truncate if too long)
 */
export function formatStatusList(
  statuses: StatusEntry[],
  maxLength: number = 10,
  emptyMessage: string = 'None'
): string {
  if (statuses.length === 0) {
    return emptyMessage;
  }

  const sorted = sortStatuses(statuses, 'expiration');
  const display = sorted.slice(0, maxLength);
  const remaining = sorted.length - maxLength;

  let result = display.map(formatStatusEntry).join('\n\n');
  
  if (remaining > 0) {
    result += `\n\n... and ${remaining} more`;
  }

  return result;
}

/**
 * Format item list for embed field (truncate if too long)
 */
export function formatItemList(
  items: ItemEntry[],
  maxLength: number = 10,
  emptyMessage: string = 'None'
): string {
  if (items.length === 0) {
    return emptyMessage;
  }

  const sorted = items.sort((a, b) => {
    if (!a.expiresAt && !b.expiresAt) return 0;
    if (!a.expiresAt) return 1;
    if (!b.expiresAt) return -1;
    return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
  });

  const display = sorted.slice(0, maxLength);
  const remaining = sorted.length - maxLength;

  let result = display.map(formatItemEntry).join('\n\n');
  
  if (remaining > 0) {
    result += `\n\n... and ${remaining} more`;
  }

  return result;
}

