import { redis, RedisKeys } from '../../../cache/client';
import logger from '../../../core/logger';
import { TournamentDocument } from '../../../types/database';

/**
 * Tournament Cache Service
 * Centralizes Redis access for tournament-related state.
 */
class TournamentCacheService {
  private readonly STATE_TTL_SECONDS = 3600; // 1 hour
  private readonly ROUND_TTL_SECONDS = 7 * 24 * 3600; // 7 days

  /**
   * Cache active tournament state snapshot for a guild.
   */
  async setTournamentState(
    guildId: string,
    state: {
      tournamentId: string;
      status: TournamentDocument['status'];
      currentRound: number;
      standings: TournamentDocument['standings'];
    }
  ): Promise<void> {
    try {
      const key = RedisKeys.tournamentState(guildId);
      await redis.setex(key, this.STATE_TTL_SECONDS, JSON.stringify(state));
    } catch (error) {
      logger.error('Failed to cache tournament state:', { guildId, error });
    }
  }

  async getTournamentState(
    guildId: string
  ): Promise<{
    tournamentId: string;
    status: TournamentDocument['status'];
    currentRound: number;
    standings: TournamentDocument['standings'];
  } | null> {
    try {
      const key = RedisKeys.tournamentState(guildId);
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      logger.error('Failed to read cached tournament state:', { guildId, error });
      return null;
    }
  }

  /**
   * Pairings per round (list of minimal match info).
   */
  async setRoundPairings(
    tournamentId: string,
    round: number,
    pairings: Array<{
      matchId: string;
      factionAId: string;
      factionBId: string | null;
    }>
  ): Promise<void> {
    try {
      const key = RedisKeys.tournamentPairings(tournamentId, round);
      await redis.setex(key, this.ROUND_TTL_SECONDS, JSON.stringify(pairings));
    } catch (error) {
      logger.error('Failed to cache tournament pairings:', { tournamentId, round, error });
    }
  }

  async getRoundPairings(
    tournamentId: string,
    round: number
  ): Promise<
    Array<{
      matchId: string;
      factionAId: string;
      factionBId: string | null;
    }> | null
  > {
    try {
      const key = RedisKeys.tournamentPairings(tournamentId, round);
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      logger.error('Failed to read cached tournament pairings:', { tournamentId, round, error });
      return null;
    }
  }

  /**
   * Joined roster per faction (set of userIds).
   */
  async addJoinedPlayer(tournamentId: string, factionId: string, userId: string): Promise<void> {
    try {
      const key = RedisKeys.tournamentRosterJoined(tournamentId, factionId);
      await redis.getClient().sadd(key, userId);
      await redis.expire(key, this.ROUND_TTL_SECONDS);
    } catch (error) {
      logger.error('Failed to add joined player to tournament roster:', {
        tournamentId,
        factionId,
        userId,
        error,
      });
    }
  }

  async getJoinedRoster(tournamentId: string, factionId: string): Promise<string[]> {
    try {
      const key = RedisKeys.tournamentRosterJoined(tournamentId, factionId);
      const members = await redis.getClient().smembers(key);
      return members ?? [];
    } catch (error) {
      logger.error('Failed to read joined tournament roster:', {
        tournamentId,
        factionId,
        error,
      });
      return [];
    }
  }

  /**
   * Voting: per-voter votes and aggregated totals.
   */
  async setVoterVotes(
    tournamentId: string,
    round: number,
    factionId: string,
    voterId: string,
    votedUserIds: string[]
  ): Promise<void> {
    try {
      const key = RedisKeys.tournamentVotes(tournamentId, round, factionId, voterId);
      const client = redis.getClient();

      await client.del(key);
      if (votedUserIds.length > 0) {
        await client.sadd(key, ...votedUserIds);
      }
      await client.expire(key, this.ROUND_TTL_SECONDS);
    } catch (error) {
      logger.error('Failed to set voter votes in tournament:', {
        tournamentId,
        round,
        factionId,
        voterId,
        error,
      });
    }
  }

  async getVoterVotes(
    tournamentId: string,
    round: number,
    factionId: string,
    voterId: string
  ): Promise<string[]> {
    try {
      const key = RedisKeys.tournamentVotes(tournamentId, round, factionId, voterId);
      const members = await redis.getClient().smembers(key);
      return members ?? [];
    } catch (error) {
      logger.error('Failed to get voter votes in tournament:', {
        tournamentId,
        round,
        factionId,
        voterId,
        error,
      });
      return [];
    }
  }

  async setVoteTotals(
    tournamentId: string,
    round: number,
    factionId: string,
    totals: { [userId: string]: number }
  ): Promise<void> {
    try {
      const key = RedisKeys.tournamentVoteTotals(tournamentId, round, factionId);
      const client = redis.getClient();

      await client.del(key);

      const entries: string[] = [];
      for (const [userId, count] of Object.entries(totals)) {
        entries.push(userId, count.toString());
      }

      if (entries.length > 0) {
        await client.hset(key, ...entries);
      }
      await client.expire(key, this.ROUND_TTL_SECONDS);
    } catch (error) {
      logger.error('Failed to set vote totals in tournament:', {
        tournamentId,
        round,
        factionId,
        error,
      });
    }
  }

  async getVoteTotals(
    tournamentId: string,
    round: number,
    factionId: string
  ): Promise<{ [userId: string]: number }> {
    try {
      const key = RedisKeys.tournamentVoteTotals(tournamentId, round, factionId);
      const client = redis.getClient();
      const raw = await client.hgetall(key);
      const totals: { [userId: string]: number } = {};
      for (const [userId, count] of Object.entries(raw)) {
        totals[userId] = Number(count) || 0;
      }
      return totals;
    } catch (error) {
      logger.error('Failed to get vote totals in tournament:', {
        tournamentId,
        round,
        factionId,
        error,
      });
      return {};
    }
  }

  /**
   * Locked roster per round.
   */
  async setLockedRoster(
    tournamentId: string,
    round: number,
    factionId: string,
    userIds: string[]
  ): Promise<void> {
    try {
      const key = RedisKeys.tournamentLockedRoster(tournamentId, round, factionId);
      const client = redis.getClient();
      await client.del(key);
      if (userIds.length > 0) {
        await client.rpush(key, ...userIds);
      }
      await client.expire(key, this.ROUND_TTL_SECONDS);
    } catch (error) {
      logger.error('Failed to set locked roster for tournament:', {
        tournamentId,
        round,
        factionId,
        error,
      });
    }
  }

  async getLockedRoster(
    tournamentId: string,
    round: number,
    factionId: string
  ): Promise<string[]> {
    try {
      const key = RedisKeys.tournamentLockedRoster(tournamentId, round, factionId);
      const client = redis.getClient();
      const members = await client.lrange(key, 0, -1);
      return members ?? [];
    } catch (error) {
      logger.error('Failed to get locked roster for tournament:', {
        tournamentId,
        round,
        factionId,
        error,
      });
      return [];
    }
  }

  /**
   * Cached VC totals per user per round.
   */
  async setVcTotal(
    tournamentId: string,
    round: number,
    userId: string,
    millis: number
  ): Promise<void> {
    try {
      const key = RedisKeys.tournamentVc(tournamentId, round, userId);
      await redis.setex(key, this.ROUND_TTL_SECONDS, millis.toString());
    } catch (error) {
      logger.error('Failed to cache VC total for tournament user:', {
        tournamentId,
        round,
        userId,
        error,
      });
    }
  }

  async getVcTotal(
    tournamentId: string,
    round: number,
    userId: string
  ): Promise<number | null> {
    try {
      const key = RedisKeys.tournamentVc(tournamentId, round, userId);
      const raw = await redis.get(key);
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    } catch (error) {
      logger.error('Failed to read cached VC total for tournament user:', {
        tournamentId,
        round,
        userId,
        error,
      });
      return null;
    }
  }

  /**
   * Simple helpers for invalidation when needed.
   */
  async clearTournamentState(guildId: string): Promise<void> {
    try {
      const key = RedisKeys.tournamentState(guildId);
      await redis.del(key);
    } catch (error) {
      logger.error('Failed to clear cached tournament state:', { guildId, error });
    }
  }
}

export const tournamentCacheService = new TournamentCacheService();

