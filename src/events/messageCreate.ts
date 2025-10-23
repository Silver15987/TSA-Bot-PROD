import { Events, Message, ChannelType } from 'discord.js';
import { factionStatsTracker } from '../modules/factions/services/factionStatsTracker';
import { database } from '../database/client';
import logger from '../core/logger';

export default {
  name: Events.MessageCreate,
  async execute(message: Message) {
    try {
      // Ignore bot messages
      if (message.author.bot) return;

      // Only process guild messages
      if (!message.guild) return;

      const guildId = message.guild.id;
      const userId = message.author.id;
      const channelId = message.channelId;

      // Check if message is in a voice channel's text channel (thread)
      // Voice channels have associated text channels in Discord
      if (message.channel.type === ChannelType.GuildVoice) {
        // Check if this voice channel is a faction VC
        const factionId = await factionStatsTracker.getFactionByChannelId(channelId, guildId);

        if (factionId) {
          // Verify user is a member of this faction
          const user = await database.users.findOne({ id: userId, guildId });

          if (user && user.currentFaction === factionId) {
            // Update faction message count
            await factionStatsTracker.updateFactionMessages(factionId, guildId, userId, 1);

            logger.debug(`Tracked message in faction ${factionId} VC from user ${userId}`);
          }
        }
      }
    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    }
  },
};
