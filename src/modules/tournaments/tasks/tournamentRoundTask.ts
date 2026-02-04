import cron from 'node-cron';
import { BotClient } from '../../../core/client';
import logger from '../../../core/logger';
import { database } from '../../../database/client';
import { TournamentDocument } from '../../../types/database';
import { tournamentRosterService } from '../services/tournamentRosterService';
import { tournamentResultService } from '../services/tournamentResultService';
import { tournamentBracketService } from '../services/tournamentBracketService';

let roundTask: cron.ScheduledTask | null = null;
let isRunning = false;

/**
 * Start the tournament round task.
 * Runs periodically and:
 * - Locks rosters 1 hour before each IST day (23:00 IST previous day).
 * - Computes results after the day ends.
 * - Advances rounds automatically.
 */
export function startTournamentRoundTask(client: BotClient): void {
  if (roundTask) {
    logger.warn('Tournament round task already running');
    return;
  }

  logger.info('Starting tournament round task (runs every 10 minutes)...');

  roundTask = cron.schedule('*/10 * * * *', async () => {
    if (isRunning) {
      logger.warn('Tournament round task already running, skipping this tick');
      return;
    }
    isRunning = true;
    try {
      await runTournamentRoundTask(client);
    } finally {
      isRunning = false;
    }
  });
}

export function stopTournamentRoundTask(): void {
  if (roundTask) {
    roundTask.stop();
    roundTask = null;
    logger.info('Tournament round task stopped');
  }
}

async function runTournamentRoundTask(client: BotClient): Promise<void> {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) {
      logger.warn('Tournament round task: Bot is not in any guilds, skipping');
      return;
    }

    const tournament = await database.tournaments.findOne<TournamentDocument>({
      guildId: guild.id,
      status: 'active',
    });

    if (!tournament) {
      return;
    }

    if (!tournament.startedAt) {
      logger.warn(`Tournament ${tournament.id} is active but has no startedAt; skipping`);
      return;
    }

    const nowUtc = new Date();
    const istNow = toIst(nowUtc);

    const round = tournament.currentRound;
    if (round <= 0) {
      return;
    }

    // Compute IST date for this round (start day = date of startedAt in IST)
    const startedIst = toIst(tournament.startedAt);
    const roundDateIst = addDays(stripTime(startedIst), round - 1);

    const lockTimeIst = new Date(roundDateIst.getTime() - 60 * 60 * 1000); // 1h before 00:00 => 23:00 previous day
    const roundEndIst = new Date(roundDateIst);
    roundEndIst.setHours(23, 59, 59, 999);

    // Lock rosters if between lock time and start of round and rosters not locked
    if (istNow >= lockTimeIst && istNow < roundDateIst) {
      await lockRostersIfNeeded(tournament, round);
    }

    // Compute results and potentially advance round once round has ended
    if (istNow >= roundEndIst) {
      await computeResultsIfNeeded(tournament, round, roundDateIst);

      // Advance to next round by generating new pairings if any participants remain
      // Decisions about when to end the tournament are deferred to bracket logic / admin commands.
      await tournamentBracketService.recomputeStandings(tournament);
    }
  } catch (error) {
    logger.error('Error in tournament round task:', error);
  }
}

async function lockRostersIfNeeded(
  tournament: TournamentDocument,
  round: number
): Promise<void> {
  const anyUnlocked = await database.tournamentMatches.findOne({
    tournamentId: tournament.id,
    round,
    rosterLockedAt: null,
  });

  if (!anyUnlocked) {
    return;
  }

  logger.info(
    `Locking rosters for tournament ${tournament.id} round ${round}`
  );

  await tournamentRosterService.lockRostersForRound(tournament, round);
}

async function computeResultsIfNeeded(
  tournament: TournamentDocument,
  round: number,
  roundDateIst: Date
): Promise<void> {
  const anyPending = await database.tournamentMatches.findOne({
    tournamentId: tournament.id,
    round,
    status: { $in: ['pending', 'in_progress'] },
  });

  if (!anyPending) {
    return;
  }

  logger.info(
    `Computing results for tournament ${tournament.id} round ${round}`
  );

  await tournamentResultService.computeResultsForRound(
    tournament,
    round,
    roundDateIst
  );
}

/**
 * Convert UTC Date to an IST-local wall-clock Date encoded in UTC.
 */
function toIst(date: Date): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const second = get('second');

  // Represent IST wall-clock time as a UTC-based Date for comparisons
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0));
}

function stripTime(date: Date): Date {
  // Strip time based on IST-local date (using UTC getters because toIst encodes IST in UTC fields)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

