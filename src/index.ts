import { readdirSync } from 'fs';
import { join } from 'path';
import { BotClient } from './core/client';
import { database } from './database/client';
import { redis } from './cache/client';
import { configManager } from './core/configManager';
import { webhookServer } from './core/webhookServer';
import { syncManager } from './modules/voiceTracking/services/syncManager';
import { recoveryManager } from './modules/voiceTracking/services/recoveryManager';
import { startUpkeepTask, stopUpkeepTask } from './modules/factions/tasks/upkeepTask';
import { upkeepManager } from './modules/factions/services/upkeepManager';
import { startQuestScheduler, stopQuestScheduler } from './modules/quests/tasks/questScheduler';
import logger from './core/logger';

/**
 * Main bot initialization
 */
async function main() {
  try {
    logger.info('Starting Discord bot...');

    // Initialize client
    const client = new BotClient();

    // Connect to database
    logger.info('Connecting to databases...');
    await database.connect();
    await redis.connect();

    // Load commands
    logger.info('Loading commands...');
    const commandsPath = join(__dirname, 'commands');
    const commandFiles = readdirSync(commandsPath).filter((file) =>
      file.endsWith('.js') || file.endsWith('.ts')
    );

    const commands = [];
    for (const file of commandFiles) {
      const filePath = join(commandsPath, file);
      const command = require(filePath).default;

      if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        commands.push(command.data.toJSON());
        logger.info(`Loaded command: ${command.data.name}`);
      } else {
        logger.warn(`Skipping invalid command file: ${file}`);
      }
    }

    // Load events
    logger.info('Loading events...');
    const eventsPath = join(__dirname, 'events');
    const eventFiles = readdirSync(eventsPath).filter((file) =>
      file.endsWith('.js') || file.endsWith('.ts')
    );

    for (const file of eventFiles) {
      const filePath = join(eventsPath, file);
      const event = require(filePath).default;

      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
      } else {
        client.on(event.name, (...args) => event.execute(...args));
      }

      logger.info(`Loaded event: ${event.name}`);
    }

    // Register slash commands
    if (commands.length > 0) {
      await client.registerCommands(commands);
    }

    // Start the bot
    await client.start();

    // Wait for bot to be ready before loading configs and starting services
    client.once('ready', async () => {
      // Load configs for all guilds
      logger.info('Loading server configurations...');
      for (const guild of client.guilds.cache.values()) {
        try {
          await configManager.loadConfig(guild.id);
        } catch (error) {
          logger.error(`Failed to load config for guild ${guild.id}:`, error);
        }
      }

      // Start webhook server for config hot-reload
      webhookServer.start();

      // Recover active VC sessions
      await recoveryManager.recoverActiveSessions(client);

      // Start periodic sync
      syncManager.start(client);

      // Check for missed faction upkeeps
      await upkeepManager.checkMissedUpkeeps(client);

      // Start faction upkeep task
      startUpkeepTask(client);

      // Start quest scheduler task
      startQuestScheduler(client);

      logger.info('All systems initialized and ready');
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received. Shutting down gracefully...`);

      syncManager.stop();
      stopUpkeepTask();
      stopQuestScheduler();
      webhookServer.stop();
      await client.stop();
      await database.disconnect();
      await redis.disconnect();

      logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error) {
    logger.error('Fatal error during startup:', error);
    process.exit(1);
  }
}

// Start the bot
main();
