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
    logger.info(`Serving ${client.guilds.cache.size} servers`);
    logger.info(`Connected to ${client.users.cache.size} users`);

    // Log server details
    client.guilds.cache.forEach((guild) => {
      logger.info(`Server: ${guild.name} (${guild.id}) - ${guild.memberCount} members`);
    });
  },
};
