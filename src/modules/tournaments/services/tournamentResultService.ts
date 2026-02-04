import { database } from '../../../database/client';
import logger from '../../../core/logger';
import { TournamentDocument, TournamentMatchDocument, VCActivityDocument } from '../../../types/database';
import { tournamentCacheService } from './tournamentCacheService';
import { getIstDayWindowUtc } from '../utils/timeUtils';

/**
 * Tournament Result Service
 * Aggregates VC time and determines winners.
 */
class TournamentResultService {
  /**
   * Compute VC millis for a user in the IST daily window for a given round date.
   * Uses cache if available.
   */
  async getUserVcMillisForRound(
    tournament: TournamentDocument,
    round: number,
    userId: string,
    date: Date
  ): Promise<number> {
    const cached = await tournamentCacheService.getVcTotal(
      tournament.id,
      round,
      userId
    );
    if (cached !== null) {
      return cached;
    }

    const { startUtc, endUtc } = getIstDayWindowUtc(date);

    const sessions: VCActivityDocument[] = await database.vcActivity
      .find({
        userId,
        guildId: tournament.guildId,
        startTime: { $lt: endUtc },
        endTime: { $gt: startUtc },
      })
      .toArray();

    let total = 0;
    for (const s of sessions) {
      total += s.duration;
    }

    await tournamentCacheService.setVcTotal(
      tournament.id,
      round,
      userId,
      total
    );

    return total;
  }

  /**
   * Compute duel results and match winner for a single match.
   */
  async computeMatchResult(
    tournament: TournamentDocument,
    match: TournamentMatchDocument,
    roundDate: Date
  ): Promise<void> {
    if (match.status === 'bye') {
      // Already handled as auto-win
      return;
    }

    const { rosterA, rosterB } = match;
    const playersPerMatch = tournament.playersPerMatch;

    if (!rosterA || !rosterB || rosterA.length === 0 || rosterB.length === 0) {
      logger.warn(
        `Match ${match.id} in tournament ${tournament.id} has empty rosters; skipping result computation`
      );
      return;
    }

    const duelResults: TournamentMatchDocument['duelResults'] = [];

    const pairs = Math.min(
      playersPerMatch,
      rosterA.length,
      rosterB.length
    );

    for (let i = 0; i < pairs; i++) {
      const userAId = rosterA[i];
      const userBId = rosterB[i];

      const vcMillisA = await this.getUserVcMillisForRound(
        tournament,
        match.round,
        userAId,
        roundDate
      );
      const vcMillisB = await this.getUserVcMillisForRound(
        tournament,
        match.round,
        userBId,
        roundDate
      );

      const winner = vcMillisA > vcMillisB ? 'A' : 'B';

      duelResults.push({
        index: i,
        userAId,
        userBId,
        vcMillisA,
        vcMillisB,
        winner,
      });
    }

    let winsA = 0;
    let winsB = 0;

    for (const d of duelResults) {
      if (d.winner === 'A') winsA += 1;
      else winsB += 1;
    }

    const winnerFactionId =
      winsA > winsB ? match.factionAId : match.factionBId!;
    const loserFactionId =
      winsA > winsB ? match.factionBId! : match.factionAId;

    await database.tournamentMatches.updateOne(
      { id: match.id, tournamentId: tournament.id },
      {
        $set: {
          duelResults,
          winnerFactionId,
          loserFactionId,
          winnerScore: winsA > winsB ? winsA : winsB,
          loserScore: winsA > winsB ? winsB : winsA,
          status: 'completed',
          computedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
  }

  /**
   * Compute results for all matches in a round and update tournament standings.
   */
  async computeResultsForRound(
    tournament: TournamentDocument,
    round: number,
    roundDate: Date
  ): Promise<void> {
    const matches = await database.tournamentMatches
      .find({ tournamentId: tournament.id, round })
      .toArray();

    for (const match of matches) {
      await this.computeMatchResult(tournament, match, roundDate);
    }
  }
}

export const tournamentResultService = new TournamentResultService();

