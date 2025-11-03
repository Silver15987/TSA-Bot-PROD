import { Events } from 'discord.js';
import logger from '../core/logger';
import { BotClient } from '../core/client';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client: BotClient) {
    if (!client.user) {
      logger.error('Client user is not available');
      return;
    }

    logger.info(`Bot ready! Logged in as ${client.user.tag}`);

    // Optimized for single-guild operation
    const guild = client.guilds.cache.first();
    if (guild) {
      logger.info(`Server: ${guild.name} (${guild.id}) - ${guild.memberCount} members`);
      logger.info(`Connected to ${client.users.cache.size} users`);
    } else {
      logger.warn('Bot is not in any guilds');
    }
  },
};
