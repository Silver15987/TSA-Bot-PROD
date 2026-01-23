import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { database } from '../database/client';
import { configManager } from '../core/configManager';
import logger from '../core/logger';
import { permissionService } from '../modules/admin/services/permissionService';
import { factionManager } from '../modules/factions/services/factionManager';
import { discordResourceManager } from '../modules/factions/services/discordResourceManager';

export default {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Event utilities for factions')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add-to-faction')
        .setDescription('Add a user to a faction for events')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('User to add to the faction')
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName('faction_role')
            .setDescription('Faction role representing the target faction')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('create-faction')
        .setDescription('Create a system event faction (Admin only)')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Name of the new system faction')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('disband-faction')
        .setDescription('Disband an event/system faction (Admin only)')
        .addRoleOption(option =>
          option
            .setName('faction_role')
            .setDescription('Faction role representing the faction to disband')
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const guildId = interaction.guildId;
      if (!guildId || !interaction.guild) {
        await interaction.reply({
          content: '❌ This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'create-faction' || subcommand === 'disband-faction') {
        // Strictly admin-only per requirements
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          await interaction.reply({
            content: '❌ You need Administrator permission to use this command.',
            ephemeral: true,
          });
          return;
        }
      } else {
        // Event manager permission for other event commands
        const member = interaction.member;
        if (!member || typeof (member as any).permissions === 'string') {
          await interaction.reply({
            content: '❌ Unable to verify permissions.',
            ephemeral: true,
          });
          return;
        }

        const permissionCheck = permissionService.hasEventManagerPermission(member as any, guildId);
        if (!permissionCheck.hasPermission) {
          await interaction.reply({
            content: `❌ ${permissionCheck.reason}`,
            ephemeral: true,
          });
          return;
        }
      }

      await interaction.deferReply({ ephemeral: true });

      switch (subcommand) {
        case 'add-to-faction':
          await handleAddToFaction(interaction, guildId);
          break;
        case 'create-faction':
          await handleCreateSystemFaction(interaction, guildId);
          break;
        case 'disband-faction':
          await handleDisbandFaction(interaction, guildId);
          break;
        default:
          await interaction.editReply({
            content: '❌ Unknown subcommand.',
          });
      }
    } catch (error) {
      logger.error('Error in event command:', error);
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

async function handleAddToFaction(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const targetUser = interaction.options.getUser('user', true);
  const factionRole = interaction.options.getRole('faction_role', true);

  if (!interaction.guild) {
    await interaction.editReply({
      content: '❌ This command can only be used in a server.',
    });
    return;
  }

  // Find faction by its Discord role ID
  const faction = await database.factions.findOne({
    guildId,
    roleId: factionRole.id,
    disbanded: { $ne: true },
  });

  if (!faction) {
    await interaction.editReply({
      content: '❌ No active faction is linked to that role. Make sure this role belongs to a faction.',
    });
    return;
  }

  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!member) {
    await interaction.editReply({
      content: '❌ Could not find that member in this server.',
    });
    return;
  }

  // If user is already in a different faction, remove them first
  const existingFaction = await factionManager.getUserFaction(targetUser.id, guildId);
  if (existingFaction && existingFaction.id !== faction.id) {
    await factionManager.removeMember(existingFaction.id, guildId, targetUser.id);
  }

  // Add user to faction members list
  await factionManager.addMember(faction.id, guildId, targetUser.id);

  // Update or create user record to point to this faction
  await database.users.updateOne(
    { id: targetUser.id, guildId },
    {
      $set: {
        id: targetUser.id,
        guildId,
        username: targetUser.username,
        discriminator: targetUser.discriminator ?? '0',
        currentFaction: faction.id,
        factionJoinDate: new Date(),
        updatedAt: new Date(),
      },
      $setOnInsert: {
        // Minimal sensible defaults for new users
        totalVcTime: 0,
        dailyVcTime: 0,
        weeklyVcTime: 0,
        monthlyVcTime: 0,
        coins: 0,
        totalCoinsEarned: 0,
        dailyCoinsEarned: 0,
        weeklyCoinsEarned: 0,
        monthlyCoinsEarned: 0,
        lastActiveDate: new Date(),
        currentStreak: 0,
        longestStreak: 0,
        factionCoinsDeposited: 0,
        factionVcTime: 0,
        lifetimeFactionVcTime: 0,
        lastDailyReset: new Date(),
        lastWeeklyReset: new Date(),
        lastMonthlyReset: new Date(),
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  // Ensure the user has the Discord role
  if (!member.roles.cache.has(factionRole.id)) {
    await member.roles.add(factionRole.id).catch(error => {
      logger.error(`Failed to add faction role ${factionRole.id} to user ${targetUser.id}:`, error);
    });
  }

  await interaction.editReply({
    content: `✅ ${targetUser} has been added to faction **${faction.name}** and given the role <@&${factionRole.id}>.`,
  });
}

/**
 * Create a new system (event) faction: provision a Discord role and voice channel, create the faction record, and mark it as a system faction in the database.
 *
 * Performs validation (server context, name length, factions enabled, unique name, and absence of conflicting Discord resources). If validation passes, it creates the Discord resources, creates the faction via the faction manager, marks the faction as a system faction with metadata, and replies to the interaction with success or error messages. On faction creation failure the created Discord resources are cleaned up.
 *
 * @param interaction - The command interaction that triggered the creation (used for options and replies)
 * @param guildId - The ID of the guild where the faction will be created
 */
async function handleCreateSystemFaction(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const name = interaction.options.getString('name', true).trim();

  if (!interaction.guild) {
    await interaction.editReply({
      content: '❌ This command can only be used in a server.',
    });
    return;
  }

  if (name.length < 2 || name.length > 32) {
    await interaction.editReply({
      content: '❌ Faction name must be between 2 and 32 characters.',
    });
    return;
  }

  // Check factions are enabled
  const config = configManager.getConfig(guildId);
  if (!config.factions.enabled) {
    await interaction.editReply({
      content: '❌ Factions are currently disabled on this server.',
    });
    return;
  }

  // Ensure name is unique
  const nameExists = await factionManager.factionNameExists(name, guildId);
  if (nameExists) {
    await interaction.editReply({
      content: '❌ A faction with that name already exists.',
    });
    return;
  }

  // Check if Discord resources already exist
  const existingResources = await discordResourceManager.checkResourcesExistByName(interaction.guild, name);
  if (existingResources.roleExists || existingResources.channelExists) {
    await interaction.editReply({
      content: `❌ Discord resources for **${name}** already exist (Role: ${existingResources.roleExists ? 'Yes' : 'No'}, Channel: ${existingResources.channelExists ? 'Yes' : 'No'}). Please manually delete them or choose a different name.`,
    });
    return;
  }

  // Create Discord resources (role + VC channel)
  const resources = await discordResourceManager.createFactionResources(interaction.guild, name);
  if (!resources) {
    await interaction.editReply({
      content: '❌ Failed to create Discord resources for the faction. Please check configuration.',
    });
    return;
  }

  /* new event driven function for adding a new faction */
  const systemOwnerId = 'EVENTFACTION';
  const initialDeposit = 0;

  const creationResult = await factionManager.createFaction(
    guildId,
    name,
    systemOwnerId,
    resources.roleId,
    resources.channelId,
    initialDeposit
  );

  if (!creationResult.success || !creationResult.factionId) {
    // Cleanup orphaned resources if database creation fails
    await discordResourceManager.deleteFactionResources(interaction.guild, resources.roleId, resources.channelId);

    await interaction.editReply({
      content: `❌ Failed to create faction: ${creationResult.error || 'Unknown error'} (Resources cleaned up)`,
    });
    return;
  }

  // Mark as system faction in the database
  await database.factions.updateOne(
    { id: creationResult.factionId, guildId },
    {
      $set: {
        isSystemFaction: true,
        createdBy: interaction.user.id,
        ownerId: systemOwnerId,
        officers: [],
        members: [],
        totalMembersEver: 0,
        peakMemberCount: 0,
        membersWhoGaveXp: [],
      },
    }
  );

  await interaction.editReply({
    content:
      `✅ System faction **${name}** has been created.\n\n` +
      `• Faction ID: \`${creationResult.factionId}\`\n` +
      `• Role: <@&${resources.roleId}>\n` +
      `• Voice Channel: <#${resources.channelId}>`,
  });

  logger.info(
    `System faction "${name}" (${creationResult.factionId}) created in guild ${guildId} by ${interaction.user.id}`
  );
}

/**
 * Disbands a system or event faction, unlinks its members, and removes associated Discord resources.
 *
 * Marks the faction as disbanded in the database, clears `currentFaction` for affected users, attempts
 * to delete the faction's role and channel (and any extra resources with the same name), edits the
 * command reply with the outcome, and logs the action. Failures to delete Discord resources are caught
 * and logged as warnings; database updates remain applied.
 *
 * @param interaction - The command interaction used to obtain options and send/edit replies
 * @param guildId - The ID of the guild where the faction exists
 */
async function handleDisbandFaction(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const factionRole = interaction.options.getRole('faction_role', true);

  if (!interaction.guild) {
    await interaction.editReply({
      content: '❌ This command can only be used in a server.',
    });
    return;
  }

  // Find faction by role ID, including disbanded ones to check status
  const faction = await database.factions.findOne({
    guildId,
    roleId: factionRole.id,
  });

  if (!faction) {
    await interaction.editReply({
      content: '❌ No faction found linked to that role.',
    });
    return;
  }

  // Check if already disbanded
  if (faction.disbanded) {
    await interaction.editReply({
      content: `❌ Faction **${faction.name}** is already disbanded.`,
    });
    return;
  }

  // Check if it is a system faction
  if (!faction.isSystemFaction && faction.ownerId !== 'EVENTFACTION') {
    await interaction.editReply({
      content: '❌ You can only disband system/event factions with this command.',
    });
    return;
  }

  // Mark faction as disbanded
  await database.factions.updateOne(
    { id: faction.id, guildId },
    {
      $set: {
        disbanded: true,
        disbandedAt: new Date(),
        disbandedReason: 'manual',
        updatedAt: new Date(),
      },
    }
  );

  // Clear currentFaction for users in this faction
  await database.users.updateMany(
    { guildId, currentFaction: faction.id },
    {
      $set: {
        currentFaction: null,
        updatedAt: new Date(),
      },
    }
  );

  // Attempt to remove Discord resources
  try {
    // Delete linked resources
    await discordResourceManager.deleteFactionResources(interaction.guild, faction.roleId, faction.channelId);

    // Check for and delete extra orphaned resources with same name
    const extraResources = await discordResourceManager.checkResourcesExistByName(interaction.guild, faction.name);
    if (extraResources.roleExists || extraResources.channelExists) {
      if (extraResources.roleId && extraResources.roleId !== faction.roleId) {
        const role = await interaction.guild.roles.fetch(extraResources.roleId).catch(() => null);
        if (role) await role.delete('Cleanup extra faction resources');
      }
      if (extraResources.channelId && extraResources.channelId !== faction.channelId) {
        const channel = await interaction.guild.channels.fetch(extraResources.channelId).catch(() => null);
        if (channel) await channel.delete('Cleanup extra faction resources');
      }
    }

  } catch (error) {
    logger.warn(`Failed to delete resources for faction ${faction.id}:`, error);
  }

  await interaction.editReply({
    content: `✅ Faction **${faction.name}** has been disbanded and its members unlinked.`,
  });

  logger.info(`Faction ${faction.id} disbanded by ${interaction.user.id} in guild ${guildId}`);
}