import 'dotenv/config';
import { TextChannel, NewsChannel, VoiceChannel, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import { database } from '../src/database/client';
import { BotClient } from '../src/core/client';
import logger from '../src/core/logger';

type Args = {
  message: string;
  messageFile?: string;
  guildId?: string;
  factionIds?: string[];
  factionNames?: string[];
  channels?: string[];
  dryRun?: boolean;
};

function parseList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { message: '' } as any;
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--message' && argv[i + 1]) {
      args.message = argv[++i];
    } else if (token === '--message-file' && argv[i + 1]) {
      args.messageFile = argv[++i];
    } else if (token === '--guild' && argv[i + 1]) {
      args.guildId = argv[++i];
    } else if (token === '--factions' && argv[i + 1]) {
      args.factionIds = parseList(argv[++i]);
    } else if (token === '--names' && argv[i + 1]) {
      args.factionNames = parseList(argv[++i]);
    } else if (token === '--channels' && argv[i + 1]) {
      args.channels = parseList(argv[++i]);
    } else if (token === '--dry-run') {
      args.dryRun = true;
    }
  }
  return args;
}

// Hardcoded system notice (embed)
const HARD_CODED_NOTICE = [
  'Unusual activity was detected involving exploitation of the coin system by certain members of the factions.',
  '',
  'All related transactions and gains have been reverted, and the responsible users have been penalized. Members who received any portion of the exploited coins have also been penalized.',
  '',
  'As a result, the factions have received a faction-wide penalty.',
  '',
  'Please ensure fair play going forward.'
].join('\n');

function buildEmbed(message?: string): EmbedBuilder {
  const desc = (message && message.trim().length > 0) ? message : HARD_CODED_NOTICE;
  return new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle('⚠️ System Notice')
    .setDescription(desc)
    .setTimestamp(new Date());
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.messageFile) {
    try {
      args.message = fs.readFileSync(args.messageFile, 'utf8');
    } catch (e) {
      console.error(`Failed to read --message-file ${args.messageFile}:`, e);
      process.exit(1);
    }
  }

  if (!args.message && !args.messageFile) {
    // No message input provided – will use the hardcoded embed by default
    console.log('No --message/--message-file provided. Using hardcoded System Notice embed.');
  }
  if (!args.message && args.messageFile === undefined) {
    // no-op: we allow empty because of hardcoded default
  } else if (!args.message && args.messageFile !== undefined && args.messageFile.trim().length === 0) {
    console.error('Invalid --message-file path.');
    process.exit(1);
  }

  // Connect DB
  await database.connect();

  // Login bot
  const client = new BotClient();
  await client.start();

  try {
    // If explicit channel IDs provided, send directly to those channels
    if (args.channels && args.channels.length) {
      console.log(`Targeting ${args.channels.length} channel(s) by ID...`);
      console.log(`Channels: ${args.channels.join(', ')}`);
      let sent = 0;
      for (const channelId of args.channels) {
        try {
          const channel = await client.channels.fetch(channelId).catch(() => null);
          if (!channel) {
            console.warn(`Skip: Channel not found (${channelId})`);
            continue;
          }
          const canText = (channel as any).isTextBased ? (channel as any).isTextBased() : (channel instanceof TextChannel || channel instanceof NewsChannel);
          try {
            if (args.dryRun) {
              console.log(`[DRY-RUN] Would send embed to channel ${channelId}`);
            } else if (canText) {
              const embed = buildEmbed(args.message);
              await (channel as any).send({ embeds: [embed] });
              console.log(`Sent embed to channel ${channelId}`);
              sent++;
            } else if (channel instanceof VoiceChannel) {
              // Attempt to send to Text-In-Voice even if isTextBased is false in this runtime
              const embed = buildEmbed(args.message);
              await (channel as any).send({ embeds: [embed] });
              console.log(`Sent embed to voice channel ${channelId} (text-in-voice)`);
              sent++;
            } else {
              console.warn(`Skip: Channel ${channelId} is not text-capable`);
            }
          } catch (sendErr) {
            console.warn(`Send failed for ${channelId}: ${(sendErr as any)?.message || sendErr}`);
          }
        } catch (err) {
          logger.error(`Failed sending to channel ${channelId}:`, err);
        }
      }
      console.log(`Done. ${args.dryRun ? 'Dry-run' : 'Sent'} messages: ${sent}/${args.channels.length}`);
      return;
    }

    // Build query
    const query: any = {};
    if (args.guildId) query.guildId = args.guildId;
    if (args.factionIds && args.factionIds.length) query.id = { $in: args.factionIds };
    if (args.factionNames && args.factionNames.length) query.name = { $in: args.factionNames };

    if (!query.id && !query.name && !query.guildId) {
      console.error('Refusing to target ALL factions without a scope. Provide --guild or --factions/--names.');
      process.exit(1);
    }

    const factions = await database.factions.find(query).toArray();
    console.log(`Targeting ${factions.length} faction channel(s).`);

    let sent = 0;
    for (const faction of factions) {
      const channelId = faction.channelId;
      const name = faction.name;
      const guildId = faction.guildId;

      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          console.warn(`Skip: Channel not found for faction ${name} (${channelId}) in guild ${guildId}`);
          continue;
        }

        // If not text-capable, try the same approach used elsewhere in codebase
        const canText = (channel as any).isTextBased ? (channel as any).isTextBased() : (channel instanceof TextChannel || channel instanceof NewsChannel);
        try {
          if (args.dryRun) {
            console.log(`[DRY-RUN] Would send embed to ${name} (${channelId})`);
          } else if (canText) {
            const embed = buildEmbed(args.message);
            await (channel as any).send({ embeds: [embed] });
            console.log(`Sent embed to ${name} (${channelId})`);
            sent++;
          } else if (channel instanceof VoiceChannel) {
            const embed = buildEmbed(args.message);
            await (channel as any).send({ embeds: [embed] });
            console.log(`Sent embed to ${name} voice channel (${channelId}) (text-in-voice)`);
            sent++;
          } else {
            console.warn(`Skip: Channel ${channelId} is not text-capable for faction ${name}`);
          }
        } catch (sendErr) {
          console.warn(`Send failed for faction ${name} (${channelId}): ${(sendErr as any)?.message || sendErr}`);
        }
      } catch (err) {
        logger.error(`Failed sending to faction ${name} (${channelId}):`, err);
      }
    }

    console.log(`Done. ${args.dryRun ? 'Dry-run' : 'Sent'} messages: ${sent}/${factions.length}`);
  } finally {
    await database.disconnect();
    await client.stop();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});


