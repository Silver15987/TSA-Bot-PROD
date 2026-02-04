import { TournamentDocument, TournamentMatchDocument } from '../../types/database';

export type TournamentStatus = TournamentDocument['status'];

export interface TournamentStandingsEntry extends TournamentDocument['standings'][number] {}

export interface TournamentPairing {
  matchId: string;
  factionAId: string;
  factionBId: string | null;
}

export interface BracketGenerationResult {
  matches: TournamentMatchDocument[];
  pairings: TournamentPairing[];
}

