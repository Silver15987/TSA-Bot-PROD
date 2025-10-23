import { Guild, Role, VoiceChannel, ChannelType, PermissionFlagsBits } from 'discord.js';
import { configManager } from '../../../core/configManager';
import logger from '../../../core/logger';

/**
 * Discord Resource Manager
 * Handles creation and deletion of Discord roles and voice channels for factions
 */
export class DiscordResourceManager {
  /**
   * Create Discord resources (role + voice channel) for a faction
   */
  async createFactionResources(
    guild: Guild,
    factionName: string
  ): Promise<{ roleId: string; channelId: string } | null> {
    try {
      const config = configManager.getConfig(guild.id);

      if (!config.factions.factionCategoryId) {
        logger.error(`Cannot create faction resources: factionCategoryId not configured for guild ${guild.id}`);
        return null;
      }

      // Verify category exists
      const category = await guild.channels.fetch(config.factions.factionCategoryId).catch(() => null);
      if (!category || category.type !== ChannelType.GuildCategory) {
        logger.error(`Invalid factionCategoryId for guild ${guild.id}: Category not found or wrong type`);
        return null;
      }

      // Create faction role
      const role = await this.createFactionRole(guild, factionName);
      if (!role) {
        return null;
      }

      // Create faction voice channel
      const channel = await this.createFactionVoiceChannel(guild, factionName, role, config.factions.factionCategoryId);
      if (!channel) {
        // Cleanup: delete the role if channel creation failed
        await role.delete('Faction channel creation failed').catch(err => {
          logger.error(`Failed to cleanup role ${role.id} after channel creation failure:`, err);
        });
        return null;
      }

      logger.info(`Created faction resources for "${factionName}": Role ${role.id}, Channel ${channel.id}`);

      return {
        roleId: role.id,
        channelId: channel.id,
      };
    } catch (error) {
      logger.error(`Failed to create faction resources for "${factionName}":`, error);
      return null;
    }
  }

  /**
   * Create faction role
   */
  private async createFactionRole(guild: Guild, factionName: string): Promise<Role | null> {
    try {
      const role = await guild.roles.create({
        name: factionName,
        color: this.generateRandomColor(),
        hoist: true,
        mentionable: true,
        reason: `Faction creation: ${factionName}`,
      });

      logger.debug(`Created faction role: ${role.id} for "${factionName}"`);
      return role;
    } catch (error) {
      logger.error(`Failed to create faction role for "${factionName}":`, error);
      return null;
    }
  }

  /**
   * Create faction voice channel
   */
  private async createFactionVoiceChannel(
    guild: Guild,
    factionName: string,
    role: Role,
    categoryId: string
  ): Promise<VoiceChannel | null> {
    try {
      const channel = await guild.channels.create({
        name: `${factionName} HQ`,
        type: ChannelType.GuildVoice,
        parent: categoryId,
        permissionOverwrites: [
          {
            id: guild.id, // @everyone
            deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
          },
          {
            id: role.id, // Faction members
            allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak],
          },
        ],
        reason: `Faction creation: ${factionName}`,
      });

      logger.debug(`Created faction voice channel: ${channel.id} for "${factionName}"`);
      return channel as VoiceChannel;
    } catch (error) {
      logger.error(`Failed to create faction voice channel for "${factionName}":`, error);
      return null;
    }
  }

  /**
   * Delete faction resources (role + voice channel)
   */
  async deleteFactionResources(guild: Guild, roleId: string, channelId: string): Promise<boolean> {
    try {
      let roleDeleted = false;
      let channelDeleted = false;

      // Delete role
      try {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (role) {
          await role.delete('Faction disbanded');
          roleDeleted = true;
          logger.debug(`Deleted faction role: ${roleId}`);
        } else {
          logger.warn(`Faction role ${roleId} not found, may have been manually deleted`);
          roleDeleted = true; // Consider it deleted if not found
        }
      } catch (error) {
        logger.error(`Failed to delete faction role ${roleId}:`, error);
      }

      // Delete channel
      try {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (channel) {
          await channel.delete('Faction disbanded');
          channelDeleted = true;
          logger.debug(`Deleted faction channel: ${channelId}`);
        } else {
          logger.warn(`Faction channel ${channelId} not found, may have been manually deleted`);
          channelDeleted = true; // Consider it deleted if not found
        }
      } catch (error) {
        logger.error(`Failed to delete faction channel ${channelId}:`, error);
      }

      return roleDeleted && channelDeleted;
    } catch (error) {
      logger.error(`Failed to delete faction resources (role: ${roleId}, channel: ${channelId}):`, error);
      return false;
    }
  }

  /**
   * Check if Discord resources exist
   */
  async checkResourcesExist(guild: Guild, roleId: string, channelId: string): Promise<{
    roleExists: boolean;
    channelExists: boolean;
  }> {
    try {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      const channel = await guild.channels.fetch(channelId).catch(() => null);

      return {
        roleExists: role !== null,
        channelExists: channel !== null,
      };
    } catch (error) {
      logger.error('Failed to check if faction resources exist:', error);
      return {
        roleExists: false,
        channelExists: false,
      };
    }
  }

  /**
   * Generate random color for faction role
   */
  private generateRandomColor(): number {
    // Generate vibrant colors (avoid too dark or too light)
    const colors = [
      0xe74c3c, // Red
      0x3498db, // Blue
      0x2ecc71, // Green
      0xf39c12, // Orange
      0x9b59b6, // Purple
      0x1abc9c, // Turquoise
      0xe91e63, // Pink
      0xff5722, // Deep Orange
      0x00bcd4, // Cyan
      0x8bc34a, // Light Green
      0xffc107, // Amber
      0xff9800, // Orange
    ];

    return colors[Math.floor(Math.random() * colors.length)];
  }
}

export const discordResourceManager = new DiscordResourceManager();
