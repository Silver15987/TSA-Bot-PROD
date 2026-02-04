import { randomInt } from 'crypto';
import { Client } from 'discord.js';
import { database } from '../../../database/client';
import { configManager } from '../../../core/configManager';
import logger from '../../../core/logger';
import { TournamentDocument, TournamentMatchDocument, UserDocument } from '../../../types/database';
import { tournamentCacheService } from './tournamentCacheService';

/**
 * Tournament Roster Service
 * Handles joins, voting, auto-fill, and final roster locking.
 */
class TournamentRosterService {
  /**
   * Join the current tournament for the user's faction.
   */
  async joinTournament(
    tournament: TournamentDocument,
    user: UserDocument
  ): Promise<{ success: boolean; reason?: string }> {
    if (!user.currentFaction) {
      return { success: false, reason: 'User is not in a faction' };
    }

    if (!tournament.participantFactionIds.includes(user.currentFaction)) {
      return { success: false, reason: 'User faction is not in this tournament' };
    }

    await tournamentCacheService.addJoinedPlayer(tournament.id, user.currentFaction, user.id);

    return { success: true };
  }

  /**
   * Set a voter's selected userIds (max = playersPerMatch, unique).
   */
  async setVotes(
    tournament: TournamentDocument,
    round: number,
    factionId: string,
    voterId: string,
    votedUserIds: string[]
  ): Promise<void> {
    // Enforce uniqueness and limit
    const unique = Array.from(new Set(votedUserIds)).slice(0, tournament.playersPerMatch);
    await tournamentCacheService.setVoterVotes(
      tournament.id,
      round,
      factionId,
      voterId,
      unique
    );
  }

  /**
   * Aggregate vote totals for a faction in a round by scanning all voter keys.
   * Note: For v1 we expect scale to be manageable; if needed later we can optimize
   * with an index of voter IDs.
   */
  async recomputeVoteTotals(
    tournament: TournamentDocument,
    round: number,
    factionId: string,
    voterIds: string[]
  ): Promise<{ [userId: string]: number }> {
    const totals: { [userId: string]: number } = {};

    for (const voterId of voterIds) {
      const votes = await tournamentCacheService.getVoterVotes(
        tournament.id,
        round,
        factionId,
        voterId
      );
      for (const userId of votes) {
        totals[userId] = (totals[userId] || 0) + 1;
      }
    }

    await tournamentCacheService.setVoteTotals(
      tournament.id,
      round,
      factionId,
      totals
    );

    return totals;
  }

  /**
   * Compute final locked roster for a faction in a round based on votes and auto-fill.
   */
  async lockRosterForFaction(
    client: Client,
    tournament: TournamentDocument,
    match: TournamentMatchDocument,
    factionId: string
  ): Promise<string[]> {
    const config = configManager.getConfig(tournament.guildId);

    const joined = await tournamentCacheService.getJoinedRoster(tournament.id, factionId);

    if (joined.length === 0) {
      logger.warn(
        `No joined players for faction ${factionId} in tournament ${tournament.id} round ${match.round}`
      );
      await tournamentCacheService.setLockedRoster(
        tournament.id,
        match.round,
        factionId,
        []
      );
      return [];
    }

    // For now we don't have a global list of all voters in Redis; use joined members as voters.
    const voterIds = joined;
    const voteTotals = await tournamentCacheService.getVoteTotals(
      tournament.id,
      match.round,
      factionId
    );

    // If no pre-computed totals, compute from per-voter keys using joined as voterIds
    const totals =
      Object.keys(voteTotals).length > 0
        ? voteTotals
        : await this.recomputeVoteTotals(tournament, match.round, factionId, voterIds);

    // Build candidate list with tie-breakers.
    // Fetch users to potentially use lifetime faction VC as tie-break; if not available, fall back.
    const users = await database.users
      .find({
        guildId: tournament.guildId,
        id: { $in: joined },
      })
      .toArray();

    const userById = new Map<string, UserDocument>();
    for (const u of users) {
      userById.set(u.id, u);
    }

    const candidates = joined.map((userId) => {
      const votes = totals[userId] || 0;
      const doc = userById.get(userId);
      const lifetimeFactionVcTime = doc?.lifetimeFactionVcTime ?? 0;
      return { userId, votes, lifetimeFactionVcTime };
    });

    candidates.sort((a, b) => {
      if (a.votes !== b.votes) return b.votes - a.votes;
      if (a.lifetimeFactionVcTime !== b.lifetimeFactionVcTime) {
        return b.lifetimeFactionVcTime - a.lifetimeFactionVcTime;
      }
      return a.userId.localeCompare(b.userId);
    });

    const locked: string[] = [];

    for (const c of candidates) {
      if (locked.length >= tournament.playersPerMatch) break;
      locked.push(c.userId);
    }

    // If still not enough, auto-fill randomly from remaining joined members.
    if (locked.length < tournament.playersPerMatch) {
      const remaining = joined.filter((id) => !locked.includes(id));
      shuffleArrayInPlace(remaining);
      for (const id of remaining) {
        if (locked.length >= tournament.playersPerMatch) break;
        locked.push(id);
      }
    }

    await tournamentCacheService.setLockedRoster(
      tournament.id,
      match.round,
      factionId,
      locked
    );

    // Persist to match document
    const rosterField =
      match.factionAId === factionId
        ? { rosterA: locked }
        : match.factionBId === factionId
        ? { rosterB: locked }
        : null;

    if (rosterField) {
      await database.tournamentMatches.updateOne(
        { id: match.id, tournamentId: tournament.id },
        {
          $set: {
            ...rosterField,
            rosterLockedAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );
    } else {
      logger.warn(
        `Faction ${factionId} not found in match ${match.id} when locking roster`
      );
    }

    return locked;
  }

  /**
   * Lock rosters for all factions in all matches of a given round.
   */
  async lockRostersForRound(
    client: Client,
    tournament: TournamentDocument,
    round: number
  ): Promise<void> {
    const matches = await database.tournamentMatches
      .find({ tournamentId: tournament.id, round })
      .toArray();

    for (const match of matches) {
      if (match.factionAId) {
        await this.lockRosterForFaction(client, tournament, match, match.factionAId);
      }
      if (match.factionBId) {
        await this.lockRosterForFaction(client, tournament, match, match.factionBId);
      }
    }
  }
}

function shuffleArrayInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export const tournamentRosterService = new TournamentRosterService();

