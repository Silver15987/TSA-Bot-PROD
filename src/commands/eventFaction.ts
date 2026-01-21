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

      if (subcommand === 'create-faction') {
        // Strictly admin-only per requirements
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          await interaction.reply({
            content: '❌ You need Administrator permission to create system factions.',
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

  // Create Discord resources (role + VC channel)
  const resources = await discordResourceManager.createFactionResources(interaction.guild, name);
  if (!resources) {
    await interaction.editReply({
      content: '❌ Failed to create Discord resources for the faction. Please check configuration.',
    });
    return;
  }

  const systemOwnerId = interaction.user.id;
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
    await interaction.editReply({
      content: `❌ Failed to create faction: ${creationResult.error || 'Unknown error'}`,
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

