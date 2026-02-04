import { randomBytes } from 'crypto';
import { database } from '../../../database/client';
import logger from '../../../core/logger';
import { TournamentDocument, TournamentMatchDocument } from '../../../types/database';
import { tournamentCacheService } from './tournamentCacheService';
import { BracketGenerationResult, TournamentPairing } from '../types';

/**
 * Tournament Bracket Service
 * Handles Swiss-style standings and pairings.
 */
class TournamentBracketService {
  /**
   * Recalculate standings from match results and persist to the tournament document.
   */
  async recomputeStandings(tournament: TournamentDocument): Promise<TournamentDocument> {
    const matches = await database.tournamentMatches
      .find({
        tournamentId: tournament.id,
        status: { $in: ['completed', 'bye'] },
      })
      .toArray();

    const standingsMap = new Map<
      string,
      {
        factionId: string;
        wins: number;
        losses: number;
        lastOpponents: string[];
        totalTournamentVcMillis: number;
      }
    >();

    // Initialize entries for all participants
    for (const factionId of tournament.participantFactionIds) {
      standingsMap.set(factionId, {
        factionId,
        wins: 0,
        losses: 0,
        lastOpponents: [],
        totalTournamentVcMillis: 0,
      });
    }

    // Sort matches by round to compute lastOpponents in chronological order
    matches.sort((a, b) => a.round - b.round);

    for (const match of matches) {
      const { factionAId, factionBId, winnerFactionId, loserFactionId, duelResults, status } =
        match;

      const a = factionAId ? standingsMap.get(factionAId) : undefined;
      const b = factionBId ? standingsMap.get(factionBId) : undefined;

      // Handle bye: factionA gets a win with no opponent
      if (status === 'bye' || !factionBId) {
        if (a) {
          a.wins += 1;
          a.lastOpponents.push('BYE');
        }
        continue;
      }

      if (!factionAId || !factionBId || !winnerFactionId || !loserFactionId || !a || !b) {
        continue;
      }

      if (winnerFactionId === factionAId) {
        a.wins += 1;
        b.losses += 1;
      } else if (winnerFactionId === factionBId) {
        b.wins += 1;
        a.losses += 1;
      }

      // Track last opponents (append; we can later take recent ones if needed)
      a.lastOpponents.push(factionBId);
      b.lastOpponents.push(factionAId);

      // Sum VC millis for both factions
      for (const duel of duelResults) {
        a.totalTournamentVcMillis += duel.vcMillisA;
        b.totalTournamentVcMillis += duel.vcMillisB;
      }
    }

    const newStandings = Array.from(standingsMap.values());

    await database.tournaments.updateOne(
      { id: tournament.id, guildId: tournament.guildId },
      {
        $set: {
          standings: newStandings,
          updatedAt: new Date(),
        },
      }
    );

    const updated: TournamentDocument = {
      ...tournament,
      standings: newStandings,
      updatedAt: new Date(),
    };

    // Cache snapshot
    await tournamentCacheService.setTournamentState(tournament.guildId, {
      tournamentId: updated.id,
      status: updated.status,
      currentRound: updated.currentRound,
      standings: updated.standings,
    });

    return updated;
  }

  /**
   * Generate pairings for a given round using Swiss-style grouping by record.
   */
  async generatePairingsForRound(
    tournament: TournamentDocument,
    round: number
  ): Promise<BracketGenerationResult> {
    // If matches already exist for this round, do not create duplicates
    const existingMatches = await database.tournamentMatches
      .find({ tournamentId: tournament.id, round })
      .toArray();
    if (existingMatches.length > 0) {
      const existingPairings: TournamentPairing[] = existingMatches.map((m) => ({
        matchId: m.id,
        factionAId: m.factionAId,
        factionBId: m.factionBId,
      }));

      logger.warn(
        `Pairings already exist for tournament ${tournament.id} round ${round}, skipping regeneration`
      );

      return {
        matches: existingMatches,
        pairings: existingPairings,
      };
    }

    // Ensure standings are up-to-date
    const upToDateTournament = await this.recomputeStandings(tournament);

    const standings = [...upToDateTournament.standings];

    // Include factions with 0-0 record that may not appear yet
    const existingIds = new Set(standings.map((s) => s.factionId));
    for (const factionId of upToDateTournament.participantFactionIds) {
      if (!existingIds.has(factionId)) {
        standings.push({
          factionId,
          wins: 0,
          losses: 0,
          lastOpponents: [],
          totalTournamentVcMillis: 0,
        });
      }
    }

    // Group by record "wins-losses"
    const groups = new Map<string, typeof standings>();
    for (const entry of standings) {
      const key = `${entry.wins}-${entry.losses}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(entry);
    }

    // Sort group keys by wins descending, losses ascending
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      const [aw, al] = a.split('-').map(Number);
      const [bw, bl] = b.split('-').map(Number);
      if (aw !== bw) return bw - aw;
      return al - bl;
    });

    const matches: TournamentMatchDocument[] = [];
    const pairings: TournamentPairing[] = [];

    // Keep track of factions that have been paired
    const paired = new Set<string>();

    // Helper to create match IDs
    const createMatchId = () =>
      `match_${Date.now()}_${randomBytes(4).toString('hex')}`;

    // Track unpaired factions between groups
    let carryOver: typeof standings[0] | null = null;

    for (const key of sortedKeys) {
      const group = groups.get(key)!;

      // Sort group deterministically: wins desc, total VC desc, factionId asc
      group.sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        if (a.totalTournamentVcMillis !== b.totalTournamentVcMillis) {
          return b.totalTournamentVcMillis - a.totalTournamentVcMillis;
        }
        return a.factionId.localeCompare(b.factionId);
      });

      const pool: typeof standings = [];

      if (carryOver) {
        pool.push(carryOver);
        carryOver = null;
      }

      for (const entry of group) {
        if (!paired.has(entry.factionId)) {
          pool.push(entry);
        }
      }

      let i = 0;
      while (i + 1 < pool.length) {
        const a = pool[i];
        const b = pool[i + 1];

        const matchId = createMatchId();
        const match: TournamentMatchDocument = {
          id: matchId,
          tournamentId: upToDateTournament.id,
          guildId: upToDateTournament.guildId,
          round,
          factionAId: a.factionId,
          factionBId: b.factionId,
          factionARecordBefore: { wins: a.wins, losses: a.losses },
          factionBRecordBefore: { wins: b.wins, losses: b.losses },
          playersPerMatch: upToDateTournament.playersPerMatch,
          rosterA: [],
          rosterB: [],
          rosterLockedAt: null,
          status: 'pending',
          roundStartAt: new Date(), // will be adjusted by scheduler
          roundEndAt: new Date(),
          duelResults: [],
          winnerFactionId: null,
          loserFactionId: null,
          winnerScore: null,
          loserScore: null,
          computedAt: null,
          resultAnnouncementMessageId: null,
          bracketImageUrl: null,
          votingSnapshot: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        matches.push(match);
        pairings.push({
          matchId,
          factionAId: a.factionId,
          factionBId: b.factionId,
        });

        paired.add(a.factionId);
        paired.add(b.factionId);

        i += 2;
      }

      // If an odd one out remains in this pool, carry to next group
      if (i < pool.length) {
        carryOver = pool[i];
      }
    }

    // Handle final carryOver as a bye, if any
    if (carryOver) {
      const a = carryOver;
      const matchId = createMatchId();
      const match: TournamentMatchDocument = {
        id: matchId,
        tournamentId: upToDateTournament.id,
        guildId: upToDateTournament.guildId,
        round,
        factionAId: a.factionId,
        factionBId: null,
        factionARecordBefore: { wins: a.wins, losses: a.losses },
        factionBRecordBefore: null,
        playersPerMatch: upToDateTournament.playersPerMatch,
        rosterA: [],
        rosterB: [],
        rosterLockedAt: null,
        status: 'bye',
        roundStartAt: new Date(),
        roundEndAt: new Date(),
        duelResults: [],
        winnerFactionId: a.factionId,
        loserFactionId: null,
        winnerScore: null,
        loserScore: null,
        computedAt: new Date(),
        resultAnnouncementMessageId: null,
        bracketImageUrl: null,
        votingSnapshot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      matches.push(match);
      pairings.push({
        matchId,
        factionAId: a.factionId,
        factionBId: null,
      });
    }

    if (matches.length === 0) {
      logger.warn(`No pairings generated for tournament ${tournament.id} round ${round}`);
    }

    // Persist matches
    if (matches.length > 0) {
      await database.tournamentMatches.insertMany(matches);
    }

    // Cache pairings
    await tournamentCacheService.setRoundPairings(tournament.id, round, pairings);

    return {
      matches,
      pairings,
    };
  }
}

export const tournamentBracketService = new TournamentBracketService();

