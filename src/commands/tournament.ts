import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  GuildMember,
} from 'discord.js';
import { database } from '../database/client';
import { configManager } from '../core/configManager';
import logger from '../core/logger';
import { factionManager } from '../modules/factions/services/factionManager';
import { permissionService } from '../modules/admin/services/permissionService';
import { tournamentManager } from '../modules/tournaments/services/tournamentManager';
import { tournamentRosterService } from '../modules/tournaments/services/tournamentRosterService';
import { tournamentCacheService } from '../modules/tournaments/services/tournamentCacheService';

export default {
  data: new SlashCommandBuilder()
    .setName('tournament')
    .setDescription('PvP tournament between factions')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    // Admin/event-manager subcommands
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new tournament (event managers only)')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Tournament name')
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('players_per_match')
            .setDescription('Number of players per faction per round')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(9)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Start the current tournament (event managers only)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancel the current tournament (event managers only)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('force-advance')
        .setDescription('Force-advance to the next round (event managers only)')
    )
    // Player-facing subcommands
    .addSubcommand((sub) =>
      sub
        .setName('join')
        .setDescription('Join your faction’s tournament roster')
    )
    .addSubcommand((sub) =>
      sub
        .setName('roster')
        .setDescription('View your faction’s current tournament roster and votes')
    )
    .addSubcommand((sub) =>
      sub
        .setName('vote')
        .setDescription('Vote for players to represent your faction this round')
        .addStringOption((opt) =>
          opt
            .setName('player_ids')
            .setDescription('Comma-separated user IDs or mentions (max N)')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View current tournament standings and matches')
    )
    .addSubcommand((sub) =>
      sub
        .setName('bracket')
        .setDescription('View the current tournament bracket image')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guildId!;

      if (!configManager.hasConfig()) {
        await interaction.reply({
          content: '❌ Server configuration is not loaded yet. Please try again in a moment.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: sub === 'join' || sub === 'vote' || sub === 'roster' });

      switch (sub) {
        case 'create':
          await handleCreateTournament(interaction, guildId);
          break;
        case 'start':
          await handleStartTournament(interaction, guildId);
          break;
        case 'cancel':
          await handleCancelTournament(interaction, guildId);
          break;
        case 'force-advance':
          await handleForceAdvance(interaction, guildId);
          break;
        case 'join':
          await handleJoin(interaction, guildId);
          break;
        case 'roster':
          await handleRoster(interaction, guildId);
          break;
        case 'vote':
          await handleVote(interaction, guildId);
          break;
        case 'view':
          await handleView(interaction, guildId);
          break;
        case 'bracket':
          await handleBracket(interaction, guildId);
          break;
        default:
          await interaction.editReply({ content: '❌ Unknown subcommand.' });
      }
    } catch (error) {
      logger.error('Error in tournament command:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ An error occurred while processing your request.',
        });
      } else {
        await interaction.reply({
          content: '❌ An error occurred while processing your request.',
          ephemeral: true,
        });
      }
    }
  },
};

async function ensureEventManager(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<boolean> {
  const member = interaction.member;
  if (!member) {
    await interaction.editReply({
      content: '❌ Unable to resolve your member information. Please try again.',
    });
    return false;
  }

  // Fetch full GuildMember if needed (interaction.member can be APIInteractionGuildMember)
  let guildMember: GuildMember;
  if (member instanceof GuildMember) {
    guildMember = member;
  } else {
    if (!interaction.guild) {
      await interaction.editReply({
        content: '❌ This command can only be used in a server.',
      });
      return false;
    }
    // APIInteractionGuildMember has user.id
    const userId = 'user' in member ? member.user.id : interaction.user.id;
    const fetched = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!fetched) {
      await interaction.editReply({
        content: '❌ Unable to resolve your member information. Please try again.',
      });
      return false;
    }
    guildMember = fetched;
  }

  const result = permissionService.hasEventManagerPermission(guildMember, guildId);
  if (!result.hasPermission) {
    await interaction.editReply({
      content: `❌ ${result.reason || 'You do not have permission to use this command.'}`,
    });
    return false;
  }

  return true;
}

async function handleCreateTournament(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  if (!(await ensureEventManager(interaction, guildId))) return;

  const name = interaction.options.getString('name', true);
  const config = configManager.getConfig(guildId);
  if (!config.tournaments?.enabled) {
    await interaction.editReply({
      content:
        '❌ Tournaments are not enabled in the server configuration. Please enable them first.',
    });
    return;
  }

  // Ensure no other active tournament
  const existingActive = await tournamentManager.getActiveTournament(guildId);
  if (existingActive) {
    await interaction.editReply({
      content: `❌ There is already an active tournament: **${existingActive.name}**.`,
    });
    return;
  }

  // Use all active factions as participants
  const factions = await factionManager.getAllFactions(guildId);
  if (factions.length < 2) {
    await interaction.editReply({
      content:
        '❌ At least two factions are required to create a tournament.',
    });
    return;
  }

  const participantFactionIds = factions.map((f) => f.id);

  const timeZone = config.tournaments.timeZone;
  const roundStartTimeLocal = config.tournaments.roundStartTimeLocal;
  const playersPerMatch =
    interaction.options.getInteger('players_per_match') ??
    (config.tournaments.defaultPlayersPerMatch ?? 3);

  const tournament = await tournamentManager.createTournament({
    guildId,
    name,
    participantFactionIds,
    playersPerMatch,
    createdBy: interaction.user.id,
    timeZone,
    roundStartTimeLocal,
  });

  await interaction.editReply({
    content:
      `✅ Tournament **${tournament.name}** created with ${participantFactionIds.length} factions.\n` +
      `Players per match: **${playersPerMatch}**.\n` +
      `Use \`/tournament start\` when you are ready to begin.`,
  });
}

async function handleStartTournament(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  if (!(await ensureEventManager(interaction, guildId))) return;

  const config = configManager.getConfig(guildId);
  if (!config.tournaments?.enabled) {
    await interaction.editReply({
      content: '❌ Tournaments are not enabled in the server configuration.',
    });
    return;
  }

  const registration = await database.tournaments.findOne({
    guildId,
    status: 'registration',
  });

  if (!registration) {
    await interaction.editReply({
      content:
        '❌ No tournament in registration state was found. Use `/tournament create` first.',
    });
    return;
  }

  const started = await tournamentManager.startTournament(registration);
  const tz = started.timeZone;
  const [startHourStr, startMinuteStr] = started.roundStartTimeLocal.split(':');
  let startHour = Number(startHourStr);
  let startMinute = Number(startMinuteStr || '0');
  // Subtract 60 minutes for lock time
  let lockHour = startHour;
  let lockMinute = startMinute - 60;
  if (lockMinute < 0) {
    lockHour -= 1;
    lockMinute += 60;
  }
  if (lockHour < 0) {
    lockHour += 24;
  }
  const pad = (n: number) => n.toString().padStart(2, '0');
  const lockTimeString = `${pad(lockHour)}:${pad(lockMinute)} ${tz}`;

  await interaction.editReply({
    content:
      `✅ Tournament **${started.name}** started.\n` +
      `Current round: **${started.currentRound}**.\n` +
      `Rosters will lock 1 hour before each round (${lockTimeString}).`,
  });
}

async function handleCancelTournament(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  if (!(await ensureEventManager(interaction, guildId))) return;

  const tournament = await database.tournaments.findOne({
    guildId,
    status: { $in: ['registration', 'active'] },
  });

  if (!tournament) {
    await interaction.editReply({
      content:
        '❌ No registration or active tournament was found to cancel.',
    });
    return;
  }

  await tournamentManager.cancelTournament(tournament);

  await interaction.editReply({
    content: `✅ Tournament **${tournament.name}** has been cancelled.`,
  });
}

async function handleForceAdvance(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  if (!(await ensureEventManager(interaction, guildId))) return;

  const active = await tournamentManager.getActiveTournament(guildId);
  if (!active) {
    await interaction.editReply({
      content: '❌ No active tournament to advance.',
    });
    return;
  }

  const next = await tournamentManager.advanceToNextRound(active);

  await interaction.editReply({
    content:
      `✅ Tournament **${next.name}** advanced to round **${next.currentRound}**.\n` +
      `New pairings have been generated.`,
  });
}

async function handleJoin(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const active = await tournamentManager.getActiveTournament(guildId);
  if (!active) {
    await interaction.editReply({
      content:
        '❌ There is no active tournament right now.',
    });
    return;
  }

  const user = await database.users.findOne({
    id: interaction.user.id,
    guildId,
  });

  if (!user) {
    await interaction.editReply({
      content:
        '❌ You are not registered in the system. Use `/register` first.',
    });
    return;
  }

  const result = await tournamentRosterService.joinTournament(active, user);

  if (!result.success) {
    await interaction.editReply({
      content: `❌ ${result.reason || 'Unable to join tournament.'}`,
    });
    return;
  }

  await interaction.editReply({
    content:
      '✅ You have been added to your faction’s tournament roster. You can now vote for players with `/tournament vote`.',
  });
}

async function handleRoster(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const active = await tournamentManager.getActiveTournament(guildId);
  if (!active) {
    await interaction.editReply({
      content: '❌ There is no active tournament right now.',
    });
    return;
  }

  const user = await database.users.findOne({
    id: interaction.user.id,
    guildId,
  });

  if (!user || !user.currentFaction) {
    await interaction.editReply({
      content:
        '❌ You are not in a faction. Join a faction to participate in the tournament.',
    });
    return;
  }

  const factionId = user.currentFaction;

  const joined = await tournamentCacheService.getJoinedRoster(
    active.id,
    factionId
  );

  if (joined.length === 0) {
    await interaction.editReply({
      content:
        'ℹ️ No one has joined the tournament roster for your faction yet.',
    });
    return;
  }

  const totals = await tournamentCacheService.getVoteTotals(
    active.id,
    active.currentRound,
    factionId
  );

  const locked = await tournamentCacheService.getLockedRoster(
    active.id,
    active.currentRound,
    factionId
  );

  // Build a basic embed
  const embed = new EmbedBuilder()
    .setTitle('Tournament Roster')
    .setDescription(
      `Faction roster for current round (Top ${active.playersPerMatch} = current selection).`
    );

  const lines = joined.map((uid) => {
    const votes = totals[uid] || 0;
    const isLocked = locked.includes(uid);
    const mention = `<@${uid}>`;
    const marker = isLocked ? '✅' : '•';
    return `${marker} ${mention} — Votes: ${votes}`;
  });

  embed.addFields({
    name: 'Players',
    value: lines.join('\n'),
  });

  await interaction.editReply({ embeds: [embed] });
}

async function handleVote(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const active = await tournamentManager.getActiveTournament(guildId);
  if (!active) {
    await interaction.editReply({
      content: '❌ There is no active tournament right now.',
    });
    return;
  }

  const user = await database.users.findOne({
    id: interaction.user.id,
    guildId,
  });

  if (!user || !user.currentFaction) {
    await interaction.editReply({
      content:
        '❌ You are not in a faction. Join a faction to vote in the tournament.',
    });
    return;
  }

  const factionId = user.currentFaction;

  const playerIdsInput = interaction.options.getString('player_ids', true);
  const rawIds = playerIdsInput
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const normalizedIds = rawIds.map((token) =>
    token.replace(/[<@!>]/g, '')
  );

  if (normalizedIds.length === 0) {
    await interaction.editReply({
      content: '❌ Please provide at least one valid user ID or mention.',
    });
    return;
  }

  // Verify that all voted players are in the same faction roster
  const joined = await tournamentCacheService.getJoinedRoster(
    active.id,
    factionId
  );

  const invalid = normalizedIds.filter((id) => !joined.includes(id));
  if (invalid.length > 0) {
    await interaction.editReply({
      content:
        '❌ All voted players must be in your faction’s tournament roster.',
    });
    return;
  }

  await tournamentRosterService.setVotes(
    active,
    active.currentRound,
    factionId,
    interaction.user.id,
    normalizedIds
  );

  await interaction.editReply({
    content:
      `✅ Your votes have been recorded for this round.\n` +
      `You can change them by calling \`/tournament vote\` again before the roster lock.`,
  });
}

async function handleView(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const active = await tournamentManager.getActiveTournament(guildId);
  if (!active) {
    await interaction.editReply({
      content: '❌ There is no active tournament right now.',
    });
    return;
  }

  const state = await tournamentCacheService.getTournamentState(guildId);
  const standings = state?.standings ?? active.standings;

  // Resolve faction names for nicer output
  // Query factions individually to include disbanded ones that may be in standings
  const factionNameMap = new Map<string, string>();
  if (standings && standings.length > 0) {
    const uniqueFactionIds = [...new Set(standings.map(s => s.factionId))];
    for (const factionId of uniqueFactionIds) {
      const faction = await database.factions.findOne({ id: factionId, guildId });
      if (faction) {
        factionNameMap.set(factionId, faction.name);
      }
    }
  }

  const resolveName = (factionId: string): string => {
    return factionNameMap.get(factionId) ?? factionId;
  };

  const embed = new EmbedBuilder()
    .setTitle(`Tournament Standings — ${active.name}`)
    .setDescription(`Current round: **${active.currentRound}**`);

  if (!standings || standings.length === 0) {
    embed.addFields({
      name: 'Standings',
      value: 'No results yet.',
    });
  } else {
    const lines = standings
      .sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        return a.factionId.localeCompare(b.factionId);
      })
      .map((s, idx) => {
        const factionName = resolveName(s.factionId);
        return `#${idx + 1} **${factionName}** — ${s.wins}-${s.losses}`;
      });

    embed.addFields({
      name: 'Standings',
      value: lines.join('\n'),
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleBracket(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const active = await tournamentManager.getActiveTournament(guildId);
  if (!active) {
    await interaction.editReply({
      content: '❌ There is no active tournament right now.',
    });
    return;
  }

  // For now, this just shows latest result announcement, or falls back to /tournament view-style info.
  const latestMatch = await database.tournamentMatches.findOne(
    {
      tournamentId: active.id,
      bracketImageUrl: { $exists: true, $ne: null },
    },
    { sort: { round: -1 } }
  );

  if (latestMatch?.bracketImageUrl) {
    await interaction.editReply({
      content: latestMatch.bracketImageUrl,
    });
    return;
  }

  // Fallback
  await handleView(interaction, guildId);
}

