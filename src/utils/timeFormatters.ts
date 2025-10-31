/**
 * Shared time formatting utilities for consistent time display across the bot.
 * All VC times in the database are stored in milliseconds.
 */

/**
 * Formats a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @param options - Formatting options
 * @returns Formatted string (e.g., "2d 5h", "3h 45m", "15m 30s")
 *
 * @example
 * formatDuration(3600000) // "1h 0m"
 * formatDuration(90000) // "1m 30s"
 * formatDuration(3600000, { includeSeconds: false }) // "1h"
 */
export function formatDuration(
  ms: number,
  options: {
    includeSeconds?: boolean;
    shortFormat?: boolean;
    maxUnits?: number;
  } = {}
): string {
  const { includeSeconds = true, shortFormat = false, maxUnits = 2 } = options;

  // Convert milliseconds to base units
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  // Calculate remainder for each unit
  const days = totalDays;
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;

  // Build the output parts
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}${shortFormat ? 'd' : days === 1 ? ' day' : ' days'}`);
  }
  if (hours > 0 && parts.length < maxUnits) {
    parts.push(`${hours}${shortFormat ? 'h' : hours === 1 ? ' hour' : ' hours'}`);
  }
  if (minutes > 0 && parts.length < maxUnits) {
    parts.push(`${minutes}${shortFormat ? 'm' : minutes === 1 ? ' minute' : ' minutes'}`);
  }
  if (includeSeconds && seconds > 0 && parts.length < maxUnits) {
    parts.push(`${seconds}${shortFormat ? 's' : seconds === 1 ? ' second' : ' seconds'}`);
  }

  // If no parts, return "0s" or "0 seconds"
  if (parts.length === 0) {
    return shortFormat ? '0s' : '0 seconds';
  }

  return shortFormat ? parts.join(' ') : parts.join(', ');
}

/**
 * Formats a duration in milliseconds to hours and minutes only.
 * Convenience function for common use case in leaderboards and stats.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., "3h 45m", "25m")
 *
 * @example
 * formatHoursMinutes(3600000) // "1h 0m"
 * formatHoursMinutes(1500000) // "25m"
 */
export function formatHoursMinutes(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Formats a duration in milliseconds to days and hours for longer durations.
 * Useful for faction stats and quest timers.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., "2d 5h", "12h")
 *
 * @example
 * formatDaysHours(86400000) // "1d 0h"
 * formatDaysHours(43200000) // "12h"
 */
export function formatDaysHours(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h`;
}

/**
 * Parses a human-readable duration string to milliseconds.
 * Supports formats like "2d", "3h", "45m", "30s" or combinations "2d 3h 45m".
 *
 * @param durationString - Duration string to parse
 * @returns Duration in milliseconds, or null if invalid
 *
 * @example
 * parseDuration("1h 30m") // 5400000
 * parseDuration("2d") // 172800000
 * parseDuration("invalid") // null
 */
export function parseDuration(durationString: string): number | null {
  const regex = /(\d+)\s*([dhms])/gi;
  let totalMs = 0;
  let match;

  while ((match = regex.exec(durationString)) !== null) {
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case 'd':
        totalMs += value * 24 * 60 * 60 * 1000;
        break;
      case 'h':
        totalMs += value * 60 * 60 * 1000;
        break;
      case 'm':
        totalMs += value * 60 * 1000;
        break;
      case 's':
        totalMs += value * 1000;
        break;
    }
  }

  return totalMs > 0 ? totalMs : null;
}

/**
 * Formats milliseconds to a compact format suitable for compact displays.
 * Automatically chooses the most appropriate single unit.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string with single unit (e.g., "2.5h", "45m", "30s")
 *
 * @example
 * formatCompact(9000000) // "2.5h"
 * formatCompact(2700000) // "45m"
 */
export function formatCompact(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = totalMinutes / 60;
  const totalDays = totalHours / 24;

  if (totalDays >= 1) {
    return `${totalDays.toFixed(1)}d`;
  } else if (totalHours >= 1) {
    return `${totalHours.toFixed(1)}h`;
  } else if (totalMinutes >= 1) {
    return `${totalMinutes}m`;
  } else {
    return `${totalSeconds}s`;
  }
}
