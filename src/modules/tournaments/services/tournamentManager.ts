import { database } from '../../../database/client';
import logger from '../../../core/logger';
import { TournamentDocument } from '../../../types/database';
import { tournamentBracketService } from './tournamentBracketService';
import { tournamentCacheService } from './tournamentCacheService';

/**
 * Tournament Manager
 * High-level CRUD and lifecycle operations for tournaments.
 */
class TournamentManager {
  /**
   * Get the active tournament for a guild, if any.
   */
  async getActiveTournament(guildId: string): Promise<TournamentDocument | null> {
    try {
      return await database.tournaments.findOne({
        guildId,
        status: 'active',
      });
    } catch (error) {
      logger.error('Failed to get active tournament:', { guildId, error });
      return null;
    }
  }

  /**
   * Create a new tournament in registration state.
   */
  async createTournament(params: {
    guildId: string;
    name: string;
    participantFactionIds: string[];
    playersPerMatch: number;
    createdBy: string;
    timeZone?: string;
    roundStartTimeLocal?: string;
  }): Promise<TournamentDocument> {
    const now = new Date();

    const tournament: TournamentDocument = {
      id: `tournament_${Date.now()}`,
      guildId: params.guildId,
      name: params.name,
      status: 'registration',
      startedAt: null,
      completedAt: null,
      participantFactionIds: params.participantFactionIds,
      playersPerMatch: params.playersPerMatch,
      timeZone: params.timeZone || 'Asia/Kolkata',
      roundStartTimeLocal: params.roundStartTimeLocal || '00:00',
      roundDurationHours: 24,
      maxRounds: null,
      currentRound: 0,
      standings: [],
      finalStandings: [],
      createdBy: params.createdBy,
      createdAt: now,
      updatedAt: now,
    };

    await database.tournaments.insertOne(tournament);

    logger.info(`Created tournament "${tournament.name}" (${tournament.id}) for guild ${tournament.guildId}`);

    return tournament;
  }

  /**
   * Start a tournament: move to active and generate first round pairings.
   */
  async startTournament(tournament: TournamentDocument): Promise<TournamentDocument> {
    if (tournament.status !== 'registration') {
      throw new Error('Tournament is not in registration state');
    }

    const now = new Date();
    const updated: TournamentDocument = {
      ...tournament,
      status: 'active',
      startedAt: now,
      currentRound: 1,
      updatedAt: now,
    };

    await database.tournaments.updateOne(
      { id: tournament.id, guildId: tournament.guildId },
      {
        $set: {
          status: updated.status,
          startedAt: updated.startedAt,
          currentRound: updated.currentRound,
          updatedAt: updated.updatedAt,
        },
      }
    );

    // Generate first round pairings (this may update standings via recomputeStandings)
    await tournamentBracketService.generatePairingsForRound(updated, 1);

    // Re-fetch tournament to get fresh standings after generatePairingsForRound
    const freshTournament = await database.tournaments.findOne<TournamentDocument>({
      id: tournament.id,
      guildId: tournament.guildId,
    });

    if (!freshTournament) {
      logger.error(`Failed to re-fetch tournament ${tournament.id} after generating pairings`);
      return updated;
    }

    // Cache state with fresh standings
    await tournamentCacheService.setTournamentState(freshTournament.guildId, {
      tournamentId: freshTournament.id,
      status: freshTournament.status,
      currentRound: freshTournament.currentRound,
      standings: freshTournament.standings,
    });

    return freshTournament;
  }

  /**
   * Advance to the next round and generate new pairings.
   */
  async advanceToNextRound(tournament: TournamentDocument): Promise<TournamentDocument> {
    if (tournament.status !== 'active') {
      throw new Error('Tournament is not active');
    }

    if (tournament.maxRounds != null && tournament.currentRound >= tournament.maxRounds) {
      throw new Error('Tournament has reached maximum rounds');
    }

    const nextRound = tournament.currentRound + 1;

    const now = new Date();
    const updated: TournamentDocument = {
      ...tournament,
      currentRound: nextRound,
      updatedAt: now,
    };

    await database.tournaments.updateOne(
      { id: tournament.id, guildId: tournament.guildId },
      {
        $set: {
          currentRound: updated.currentRound,
          updatedAt: updated.updatedAt,
        },
      }
    );

    // Generate pairings for next round (this may update standings via recomputeStandings)
    await tournamentBracketService.generatePairingsForRound(updated, nextRound);

    // Re-fetch tournament to get fresh standings after generatePairingsForRound
    const freshTournament = await database.tournaments.findOne<TournamentDocument>({
      id: tournament.id,
      guildId: tournament.guildId,
    });

    if (!freshTournament) {
      logger.error(`Failed to re-fetch tournament ${tournament.id} after generating pairings`);
      return updated;
    }

    // Cache state with fresh standings
    await tournamentCacheService.setTournamentState(freshTournament.guildId, {
      tournamentId: freshTournament.id,
      status: freshTournament.status,
      currentRound: freshTournament.currentRound,
      standings: freshTournament.standings,
    });

    return freshTournament;
  }

  /**
   * Mark tournament as completed and store final standings.
   * (For now, just set status; ranking can be handled by bracket service.)
   */
  async completeTournament(tournament: TournamentDocument): Promise<void> {
    const now = new Date();

    await database.tournaments.updateOne(
      { id: tournament.id, guildId: tournament.guildId },
      {
        $set: {
          status: 'completed',
          completedAt: now,
          updatedAt: now,
        },
      }
    );

    await tournamentCacheService.clearTournamentState(tournament.guildId);
  }

  /**
   * Cancel a tournament.
   */
  async cancelTournament(tournament: TournamentDocument): Promise<void> {
    const now = new Date();

    await database.tournaments.updateOne(
      { id: tournament.id, guildId: tournament.guildId },
      {
        $set: {
          status: 'cancelled',
          updatedAt: now,
        },
      }
    );

    await tournamentCacheService.clearTournamentState(tournament.guildId);
  }
}

export const tournamentManager = new TournamentManager();

