import { createCanvas } from 'canvas';
import { TournamentDocument, TournamentMatchDocument } from '../../../types/database';

/**
 * Simple bracket/standings image generator.
 * Note: This is intentionally minimal and can be evolved later.
 */
export async function renderBracketImage(
  tournament: TournamentDocument,
  matches: TournamentMatchDocument[],
  factionNames: Map<string, string>
): Promise<Buffer> {
  const width = 800;
  const height = 600;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1e1e2f';
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = '28px Sans-serif';
  ctx.fillText(`Tournament: ${tournament.name}`, 40, 50);
  ctx.font = '20px Sans-serif';
  ctx.fillText(`Round ${tournament.currentRound}`, 40, 80);

  // Matches
  ctx.font = '16px Sans-serif';
  let y = 120;
  const lineHeight = 24;

  const getName = (id: string | null): string => {
    if (!id) return 'BYE';
    return factionNames.get(id) ?? id;
  };

  for (const match of matches) {
    if (y > height - 40) break;
    const a = getName(match.factionAId);
    const b = match.factionBId ? getName(match.factionBId) : 'BYE';
    const status = match.status;
    const score =
      match.winnerScore !== null && match.loserScore !== null
        ? `${match.winnerScore}–${match.loserScore}`
        : status === 'bye'
        ? 'BYE'
        : '';

    let line = `${a} vs ${b}`;
    if (score) {
      line += ` (${score})`;
    }

    ctx.fillText(line, 40, y);
    y += lineHeight;
  }

  return canvas.toBuffer('image/png');
}

