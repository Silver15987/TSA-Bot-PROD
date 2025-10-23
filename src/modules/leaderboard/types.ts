/**
 * Leaderboard Types
 */

/**
 * Leaderboard entry for personal rankings
 */
export interface UserLeaderboardEntry {
  userId: string;
  username: string;
  value: number;
  rank: number;
}

/**
 * Leaderboard entry for faction member rankings
 */
export interface FactionMemberEntry {
  userId: string;
  username: string;
  value: number;
  rank: number;
}

/**
 * Leaderboard entry for faction rankings
 */
export interface FactionLeaderboardEntry {
  factionId: string;
  factionName: string;
  treasury: number;
  rank: number;
}

/**
 * Personal leaderboard types
 */
export type PersonalLeaderboardType = 'coins' | 'vctime' | 'streak';

/**
 * Faction member leaderboard types
 */
export type FactionMemberLeaderboardType = 'deposits' | 'vctime';

/**
 * Cache result with metadata
 */
export interface CachedLeaderboardResult<T> {
  data: T[];
  cachedAt: Date;
  expiresAt: Date;
}

/**
 * Leaderboard calculation result
 */
export interface LeaderboardResult<T> {
  entries: T[];
  total: number;
  fromCache: boolean;
}
