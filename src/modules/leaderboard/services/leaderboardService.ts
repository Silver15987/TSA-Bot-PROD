import { database } from '../../../database/client';
import {
  UserLeaderboardEntry,
  FactionMemberEntry,
  FactionLeaderboardEntry,
  PersonalLeaderboardType,
  FactionMemberLeaderboardType,
  LeaderboardResult,
} from '../types';
import { cacheService } from './cacheService';
import logger from '../../../core/logger';

/**
 * Leaderboard Service
 * Handles leaderboard data calculation and retrieval
 */
export class LeaderboardService {
  private readonly LEADERBOARD_LIMIT = 10;

  /**
   * Get personal leaderboard (coins, vctime, or streak)
   */
  async getPersonalLeaderboard(
    guildId: string,
    type: PersonalLeaderboardType
  ): Promise<LeaderboardResult<UserLeaderboardEntry>> {
    const cacheKey = cacheService.buildPersonalLeaderboardKey(guildId, type);

    const { data, fromCache } = await cacheService.getOrCalculate(
      cacheKey,
      () => this.calculatePersonalLeaderboard(guildId, type)
    );

    return {
      entries: data,
      total: data.length,
      fromCache,
    };
  }

  /**
   * Get faction member leaderboard (internal faction rankings)
   */
  async getFactionMemberLeaderboard(
    guildId: string,
    factionId: string,
    type: FactionMemberLeaderboardType
  ): Promise<LeaderboardResult<FactionMemberEntry>> {
    const cacheKey = cacheService.buildFactionMemberKey(guildId, factionId, type);

    const { data, fromCache } = await cacheService.getOrCalculate(
      cacheKey,
      () => this.calculateFactionMemberLeaderboard(guildId, factionId, type)
    );

    return {
      entries: data,
      total: data.length,
      fromCache,
    };
  }

  /**
   * Get faction rankings (treasury-based only)
   */
  async getFactionRankings(guildId: string): Promise<LeaderboardResult<FactionLeaderboardEntry>> {
    const cacheKey = cacheService.buildFactionRankingsKey(guildId);

    const { data, fromCache } = await cacheService.getOrCalculate(
      cacheKey,
      () => this.calculateFactionRankings(guildId)
    );

    return {
      entries: data,
      total: data.length,
      fromCache,
    };
  }

  /**
   * Calculate personal leaderboard from database
   */
  private async calculatePersonalLeaderboard(
    guildId: string,
    type: PersonalLeaderboardType
  ): Promise<UserLeaderboardEntry[]> {
    try {
      logger.info(`Calculating personal leaderboard for guild ${guildId}, type: ${type}`);

      // Determine sort field and filter
      let sortField: string;
      let filter: any = { guildId };

      switch (type) {
        case 'coins':
          sortField = 'coins';
          filter.coins = { $gt: 0 }; // Only users with coins
          break;
        case 'vctime':
          sortField = 'totalVcTime';
          filter.totalVcTime = { $gt: 0 }; // Only users with VC time
          break;
        case 'streak':
          sortField = 'currentStreak';
          filter.currentStreak = { $gt: 0 }; // Only users with active streaks
          break;
        default:
          throw new Error(`Invalid leaderboard type: ${type}`);
      }

      // Query database
      const users = await database.users
        .find(filter)
        .sort({ [sortField]: -1 })
        .limit(this.LEADERBOARD_LIMIT)
        .toArray();

      // Map to leaderboard entries
      const entries: UserLeaderboardEntry[] = users.map((user, index) => ({
        userId: user.id,
        username: user.username,
        value: user[sortField as keyof typeof user] as number,
        rank: index + 1,
      }));

      logger.info(`Calculated ${entries.length} entries for personal leaderboard (${type})`);
      return entries;
    } catch (error) {
      logger.error(`Error calculating personal leaderboard (${type}):`, error);
      return [];
    }
  }

  /**
   * Calculate faction member leaderboard from database
   */
  private async calculateFactionMemberLeaderboard(
    guildId: string,
    factionId: string,
    type: FactionMemberLeaderboardType
  ): Promise<FactionMemberEntry[]> {
    try {
      logger.info(
        `Calculating faction member leaderboard for faction ${factionId}, type: ${type}`
      );

      // Determine sort field
      let sortField: string;
      let filter: any = { guildId, currentFaction: factionId };

      switch (type) {
        case 'deposits':
          sortField = 'factionCoinsDeposited';
          filter.factionCoinsDeposited = { $gt: 0 };
          break;
        case 'vctime':
          sortField = 'totalVcTime';
          filter.totalVcTime = { $gt: 0 };
          break;
        default:
          throw new Error(`Invalid faction member leaderboard type: ${type}`);
      }

      // Query database
      const members = await database.users
        .find(filter)
        .sort({ [sortField]: -1 })
        .limit(this.LEADERBOARD_LIMIT)
        .toArray();

      // Map to leaderboard entries
      const entries: FactionMemberEntry[] = members.map((member, index) => ({
        userId: member.id,
        username: member.username,
        value: member[sortField as keyof typeof member] as number,
        rank: index + 1,
      }));

      logger.info(`Calculated ${entries.length} entries for faction member leaderboard (${type})`);
      return entries;
    } catch (error) {
      logger.error(`Error calculating faction member leaderboard (${type}):`, error);
      return [];
    }
  }

  /**
   * Calculate faction rankings from database (treasury-based only)
   */
  private async calculateFactionRankings(guildId: string): Promise<FactionLeaderboardEntry[]> {
    try {
      logger.info(`Calculating faction rankings for guild ${guildId}`);

      // Query factions sorted by treasury
      const factions = await database.factions
        .find({ guildId, treasury: { $gt: 0 } })
        .sort({ treasury: -1 })
        .limit(this.LEADERBOARD_LIMIT)
        .toArray();

      // Map to leaderboard entries
      const entries: FactionLeaderboardEntry[] = factions.map((faction, index) => ({
        factionId: faction.id,
        factionName: faction.name,
        treasury: faction.treasury,
        rank: index + 1,
      }));

      logger.info(`Calculated ${entries.length} entries for faction rankings`);
      return entries;
    } catch (error) {
      logger.error('Error calculating faction rankings:', error);
      return [];
    }
  }

  /**
   * Invalidate cache for a user's personal leaderboards
   */
  async invalidatePersonalLeaderboards(guildId: string): Promise<void> {
    const types: PersonalLeaderboardType[] = ['coins', 'vctime', 'streak'];
    for (const type of types) {
      const cacheKey = cacheService.buildPersonalLeaderboardKey(guildId, type);
      await cacheService.invalidate(cacheKey);
    }
  }

  /**
   * Invalidate cache for a faction's member leaderboards
   */
  async invalidateFactionMemberLeaderboards(guildId: string, factionId: string): Promise<void> {
    const types: FactionMemberLeaderboardType[] = ['deposits', 'vctime'];
    for (const type of types) {
      const cacheKey = cacheService.buildFactionMemberKey(guildId, factionId, type);
      await cacheService.invalidate(cacheKey);
    }
  }

  /**
   * Invalidate cache for faction rankings
   */
  async invalidateFactionRankings(guildId: string): Promise<void> {
    const cacheKey = cacheService.buildFactionRankingsKey(guildId);
    await cacheService.invalidate(cacheKey);
  }
}

export const leaderboardService = new LeaderboardService();
