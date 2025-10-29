import { VoiceChannel, ChannelType } from 'discord.js';
import { BotClient } from '../../../core/client';
import { configManager } from '../../../core/configManager';
import logger from '../../../core/logger';

/**
 * Category Validator
 * Checks if a voice channel belongs to the tracked category
 */
export class CategoryValidator {
  /**
   * Check if a channel is trackable (belongs to tracked categories)
   */
  async isTrackableChannel(
    channelId: string,
    guildId: string,
    client: BotClient
  ): Promise<boolean> {
    try {
      const config = configManager.getConfig(guildId);

      if (!config.vcTracking.enabled) {
        return false;
      }

      const channel = await client.channels.fetch(channelId);

      if (!channel) {
        logger.warn(`Channel ${channelId} not found`);
        return false;
      }

      if (channel.type !== ChannelType.GuildVoice) {
        return false;
      }

      const voiceChannel = channel as VoiceChannel;

      if (!voiceChannel.parentId) {
        return false;
      }

      // Check if channel's parent is in any of the tracked categories
      return config.vcTracking.trackedCategoryIds.includes(voiceChannel.parentId);
    } catch (error) {
      logger.error(`Error checking if channel ${channelId} is trackable:`, error);
      return false;
    }
  }

  /**
   * Get tracked category IDs for a guild
   */
  getTrackedCategoryIds(guildId: string): string[] {
    const config = configManager.getConfig(guildId);
    return config.vcTracking.trackedCategoryIds;
  }

  /**
   * Check if VC tracking is enabled for a guild
   */
  isTrackingEnabled(guildId: string): boolean {
    try {
      const config = configManager.getConfig(guildId);
      return config.vcTracking.enabled;
    } catch (error) {
      return false;
    }
  }
}

export const categoryValidator = new CategoryValidator();
