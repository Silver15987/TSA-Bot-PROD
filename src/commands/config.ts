import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { database } from '../database/client';
import { configManager } from '../core/configManager';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Manage server configuration (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-faction-category')
        .setDescription('Set the category for faction voice channels')
        .addStringOption(option =>
          option
            .setName('category_id')
            .setDescription('Discord category channel ID')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View current server configuration')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reload')
        .setDescription('Reload configuration from database')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-staff-roles')
        .setDescription('Set roles that can use staff commands')
        .addStringOption(option =>
          option
            .setName('role_ids')
            .setDescription('Comma-separated list of role IDs (e.g., 123,456,789)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-audit-channel')
        .setDescription('Set the channel for audit logs')
        .addStringOption(option =>
          option
            .setName('channel_id')
            .setDescription('Text channel ID for audit logs')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-announcement-channel')
        .setDescription('Set the channel for faction announcements')
        .addStringOption(option =>
          option
            .setName('channel_id')
            .setDescription('Text/Announcement channel ID for faction announcements')
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      // Verify admin permissions
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: '❌ You need Administrator permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const subcommand = interaction.options.getSubcommand();
      const guildId = interaction.guildId!;

      switch (subcommand) {
        case 'set-faction-category':
          await handleSetFactionCategory(interaction, guildId);
          break;
        case 'set-staff-roles':
          await handleSetStaffRoles(interaction, guildId);
          break;
        case 'set-audit-channel':
          await handleSetAuditChannel(interaction, guildId);
          break;
        case 'set-announcement-channel':
          await handleSetAnnouncementChannel(interaction, guildId);
          break;
        case 'view':
          await handleView(interaction, guildId);
          break;
        case 'reload':
          await handleReload(interaction, guildId);
          break;
        default:
          await interaction.editReply({
            content: '❌ Unknown subcommand',
          });
      }
    } catch (error) {
      logger.error('Error in config command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while processing your request. Please try again.',
      });
    }
  },
};

/**
 * Handle /config set-faction-category
 */
async function handleSetFactionCategory(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const categoryId = interaction.options.getString('category_id', true);

  try {
    // Verify the category exists and is a valid category channel
    const category = await interaction.guild?.channels.fetch(categoryId).catch(() => null);

    if (!category) {
      await interaction.editReply({
        content: '❌ Category channel not found. Please provide a valid category channel ID.',
      });
      return;
    }

    if (category.type !== 4) { // ChannelType.GuildCategory = 4
      await interaction.editReply({
        content: '❌ The provided ID is not a category channel. Please provide a valid category channel ID.',
      });
      return;
    }

    // Update the configuration in the database
    await database.serverConfigs.updateOne(
      { guildId },
      {
        $set: {
          'factions.factionCategoryId': categoryId,
          updatedAt: new Date(),
          updatedBy: interaction.user.id,
        },
        $inc: { version: 1 },
      },
      { upsert: true }
    );

    // Reload the configuration
    await configManager.reloadConfig(guildId);

    await interaction.editReply({
      content: `✅ Faction category has been set to: **${category.name}** (${categoryId})\n\n` +
        `Faction voice channels will now be created in this category.`,
    });

    logger.info(`Faction category set to ${categoryId} for guild ${guildId} by ${interaction.user.id}`);
  } catch (error) {
    logger.error('Error setting faction category:', error);
    throw error;
  }
}

/**
 * Handle /config view
 */
async function handleView(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  try {
    const config = configManager.getConfig(guildId);

    const configText = `**Server Configuration**\n\n` +
      `**Voice Tracking:**\n` +
      `• Enabled: ${config.vcTracking.enabled ? '✅' : '❌'}\n` +
      `• Tracked Category: ${config.vcTracking.trackedCategoryId}\n` +
      `• Coins per Second: ${config.vcTracking.coinsPerSecond}\n` +
      `• Session TTL: ${config.vcTracking.sessionTTL}s\n` +
      `• Sync Interval: ${config.vcTracking.syncInterval}s\n\n` +

      `**Economy:**\n` +
      `• Starting Coins: ${config.economy.startingCoins}\n\n` +

      `**Factions:**\n` +
      `• Enabled: ${config.factions.enabled ? '✅' : '❌'}\n` +
      `• Faction Category: ${config.factions.factionCategoryId || 'Not set'}\n` +
      `• Max Factions: ${config.factions.maxFactionsPerServer}\n` +
      `• Creation Cost: ${config.factions.createCost} coins\n` +
      `• Min Initial Deposit: ${config.factions.minInitialDeposit} coins\n` +
      `• Daily Upkeep: ${config.factions.dailyUpkeepCost} coins\n` +
      `• Max Members: ${config.factions.maxMembersPerFaction}\n\n` +

      `**Gambling:**\n` +
      `• Enabled: ${config.gambling.enabled ? '✅' : '❌'}\n` +
      `• Coinflip: ${config.gambling.coinflip.minBet}-${config.gambling.coinflip.maxBet} coins (${config.gambling.coinflip.houseEdge * 100}% edge)\n` +
      `• Slots: ${config.gambling.slots.minBet}-${config.gambling.slots.maxBet} coins (${config.gambling.slots.houseEdge * 100}% edge)\n\n` +

      `**Admin:**\n` +
      `• Staff Roles: ${config.admin?.staffRoleIds?.length > 0 ? config.admin.staffRoleIds.map(id => `<@&${id}>`).join(', ') : 'Not set'}\n` +
      `• Audit Log Channel: ${config.admin?.auditLogChannelId ? `<#${config.admin.auditLogChannelId}>` : 'Not set'}\n\n` +

      `**Metadata:**\n` +
      `• Version: ${config.version}\n` +
      `• Last Updated: ${config.updatedAt.toLocaleString()}\n` +
      `• Updated By: <@${config.updatedBy}>`;

    await interaction.editReply({
      content: configText,
    });
  } catch (error) {
    logger.error('Error viewing config:', error);
    throw error;
  }
}

/**
 * Handle /config reload
 */
async function handleReload(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  try {
    await configManager.reloadConfig(guildId);

    await interaction.editReply({
      content: '✅ Configuration has been reloaded from the database.',
    });

    logger.info(`Config reloaded for guild ${guildId} by ${interaction.user.id}`);
  } catch (error) {
    logger.error('Error reloading config:', error);
    throw error;
  }
}

/**
 * Handle /config set-staff-roles
 */
async function handleSetStaffRoles(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const roleIdsInput = interaction.options.getString('role_ids', true);

  try {
    // Parse role IDs
    const roleIds = roleIdsInput.split(',').map(id => id.trim()).filter(id => id.length > 0);

    if (roleIds.length === 0) {
      await interaction.editReply({
        content: '❌ Please provide at least one valid role ID.',
      });
      return;
    }

    // Verify all role IDs exist
    const invalidRoles: string[] = [];
    for (const roleId of roleIds) {
      const role = await interaction.guild?.roles.fetch(roleId).catch(() => null);
      if (!role) {
        invalidRoles.push(roleId);
      }
    }

    if (invalidRoles.length > 0) {
      await interaction.editReply({
        content: `❌ The following role IDs are invalid: ${invalidRoles.join(', ')}\n\nPlease check the role IDs and try again.`,
      });
      return;
    }

    // Update the configuration in the database
    await database.serverConfigs.updateOne(
      { guildId },
      {
        $set: {
          'admin.staffRoleIds': roleIds,
          updatedAt: new Date(),
          updatedBy: interaction.user.id,
        },
        $inc: { version: 1 },
      },
      { upsert: true }
    );

    // Reload the configuration
    await configManager.reloadConfig(guildId);

    await interaction.editReply({
      content: `✅ Staff roles have been set!\n\n` +
        `**Roles:** ${roleIds.map(id => `<@&${id}>`).join(', ')}\n\n` +
        `Users with these roles can now use staff commands (/add, /remove, /faction-add, /faction-remove).`,
    });

    logger.info(`Staff roles set for guild ${guildId} by ${interaction.user.id}: ${roleIds.join(', ')}`);
  } catch (error) {
    logger.error('Error setting staff roles:', error);
    throw error;
  }
}

/**
 * Handle /config set-audit-channel
 */
async function handleSetAuditChannel(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const channelId = interaction.options.getString('channel_id', true);

  try {
    // Verify the channel exists and is a text or announcement channel
    const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);

    if (!channel) {
      await interaction.editReply({
        content: '❌ Channel not found. Please provide a valid text or announcement channel ID.',
      });
      return;
    }

    // ChannelType.GuildText = 0, ChannelType.GuildAnnouncement = 5
    if (channel.type !== 0 && channel.type !== 5) {
      await interaction.editReply({
        content: '❌ The provided ID is not a text or announcement channel. Please provide a valid channel ID where messages can be sent.',
      });
      return;
    }

    // Update the configuration in the database
    await database.serverConfigs.updateOne(
      { guildId },
      {
        $set: {
          'admin.auditLogChannelId': channelId,
          updatedAt: new Date(),
          updatedBy: interaction.user.id,
        },
        $inc: { version: 1 },
      },
      { upsert: true }
    );

    // Reload the configuration
    await configManager.reloadConfig(guildId);

    await interaction.editReply({
      content: `✅ Audit log channel has been set to: <#${channelId}>\n\n` +
        `All staff economy actions will be logged to this channel.`,
    });

    logger.info(`Audit log channel set to ${channelId} for guild ${guildId} by ${interaction.user.id}`);
  } catch (error) {
    logger.error('Error setting audit channel:', error);
    throw error;
  }
}

/**
 * Handle /config set-announcement-channel
 */
async function handleSetAnnouncementChannel(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const channelId = interaction.options.getString('channel_id', true);

  try {
    // Verify the channel exists and is a text or announcement channel
    const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);

    if (!channel) {
      await interaction.editReply({
        content: '❌ Channel not found. Please provide a valid text or announcement channel ID.',
      });
      return;
    }

    // ChannelType.GuildText = 0, ChannelType.GuildAnnouncement = 5
    if (channel.type !== 0 && channel.type !== 5) {
      await interaction.editReply({
        content: '❌ The provided ID is not a text or announcement channel. Please provide a valid channel ID where messages can be sent.',
      });
      return;
    }

    // Update the configuration in the database
    await database.serverConfigs.updateOne(
      { guildId },
      {
        $set: {
          'factions.announcementChannelId': channelId,
          updatedAt: new Date(),
          updatedBy: interaction.user.id,
        },
        $inc: { version: 1 },
      },
      { upsert: true }
    );

    // Reload the configuration
    await configManager.reloadConfig(guildId);

    await interaction.editReply({
      content: `✅ Faction announcement channel has been set to: <#${channelId}>\n\n` +
        `All faction creations and disbands will be announced in this channel.`,
    });

    logger.info(`Faction announcement channel set to ${channelId} for guild ${guildId} by ${interaction.user.id}`);
  } catch (error) {
    logger.error('Error setting announcement channel:', error);
    throw error;
  }
}
