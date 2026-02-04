import { TournamentDocument, TournamentMatchDocument } from '../../types/database';

export type TournamentStatus = TournamentDocument['status'];

export type TournamentStandingsEntry = TournamentDocument['standings'][number];

export interface TournamentPairing {
  matchId: string;
  factionAId: string;
  factionBId: string | null;
}

export interface BracketGenerationResult {
  matches: TournamentMatchDocument[];
  pairings: TournamentPairing[];
}

