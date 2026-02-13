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
import { startRoleStatusExpirationTask, stopRoleStatusExpirationTask } from './modules/roles/tasks/roleStatusExpirationTask';
import { startTournamentRoundTask, stopTournamentRoundTask } from './modules/tournaments/tasks/tournamentRoundTask';
import logger from './core/logger';

/**
 * Global error handlers to prevent silent crashes
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection:', {
    reason,
    promise: promise.toString(),
    stack: reason instanceof Error ? reason.stack : undefined
  });
  // Log but don't exit - allow process to continue
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Critical error - attempt graceful shutdown
  shutdown('UNCAUGHT_EXCEPTION').catch(() => process.exit(1));
});

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received. Shutting down gracefully...`);

  try {
    syncManager.stop();
    stopUpkeepTask();
    stopQuestScheduler();
    stopRoleStatusExpirationTask();
    stopTournamentRoundTask();
    webhookServer.stop();

    // Give ongoing operations time to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    await database.disconnect();
    await redis.disconnect();

    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

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
      (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts')
    );

    // Quest command file names to skip when quests are disabled
    const questCommandFiles = ['quest.ts', 'quest.js', 'questAdmin.ts', 'questAdmin.js'];

    const commands = [];
    const questCommands: any[] = []; // Store quest commands for conditional registration
    
    for (const file of commandFiles) {
      const filePath = join(commandsPath, file);
      try {
        logger.info(`Loading command file: ${file}`);
        const command = require(filePath).default;

        if ('data' in command && 'execute' in command) {
          // Skip quest commands - they'll be conditionally registered after config loads
          const isQuestCommand = questCommandFiles.includes(file);
          if (isQuestCommand) {
            logger.info(`Quest command ${command.data.name} will be conditionally loaded after config check`);
            questCommands.push({ commandData: command.data.toJSON(), commandModule: command });
            continue;
          }

          client.commands.set(command.data.name, command);
          commands.push(command.data.toJSON());
          logger.info(`Loaded command: ${command.data.name}`);
        } else {
          logger.warn(`Skipping invalid command file: ${file}`);
        }
      } catch (error) {
        logger.error(`Failed to load command file: ${file}`, error);
        throw error; // Re-throw to see the full error
      }
    }

    // Store quest commands on client for later conditional registration
    (client as any).questCommands = questCommands;

    // Load module commands (role-specific commands)
    logger.info('Loading module commands...');
    const modulesRolesCommandsPath = join(__dirname, 'modules', 'roles', 'commands');
    try {
      const moduleCommandFiles = readdirSync(modulesRolesCommandsPath).filter((file) =>
        (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts')
      );

      for (const file of moduleCommandFiles) {
        const filePath = join(modulesRolesCommandsPath, file);
        try {
          logger.info(`Loading module command file: ${file}`);
          const command = require(filePath).default;

          if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            commands.push(command.data.toJSON());
            logger.info(`Loaded module command: ${command.data.name}`);
          } else {
            logger.warn(`Skipping invalid module command file: ${file}`);
          }
        } catch (error) {
          logger.error(`Failed to load module command file: ${file}`, error);
          // Don't throw - allow other commands to load
        }
      }
    } catch (error) {
      // Directory might not exist yet, that's okay
      logger.debug('Module commands directory not found or empty:', error);
    }

    // Load events
    logger.info('Loading events...');
    const eventsPath = join(__dirname, 'events');
    const eventFiles = readdirSync(eventsPath).filter((file) =>
      (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts')
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
      // Load config for the single guild (optimized for single-guild operation)
      logger.info('Loading server configuration...');
      const guild = client.guilds.cache.first();
      if (!guild) {
        logger.error('Bot is not in any guilds. Please add the bot to a server.');
        return;
      }

      try {
        await configManager.loadConfig(guild.id);
      } catch (error) {
        logger.error(`Failed to load config for guild ${guild.id}:`, error);
        return;
      }

      const config = configManager.getConfig(guild.id);

      // Conditionally register quest commands based on config
      const questsEnabled = config.quests?.enabled !== false;
      const questCommands = (client as any).questCommands || [];
      
      if (questsEnabled && questCommands.length > 0) {
        logger.info('Quest system enabled - registering quest commands');
        // Add quest commands to client.commands for runtime execution
        const questCommandData: any[] = [];
        for (const { commandData, commandModule } of questCommands) {
          client.commands.set(commandData.name, commandModule);
          questCommandData.push(commandData);
        }
        const allCommands = [...commands, ...questCommandData];
        await client.registerCommands(allCommands);
        logger.info(`Registered ${questCommandData.length} quest commands`);
      } else if (!questsEnabled) {
        logger.info('Quest system DISABLED - quest commands not registered');
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

      // Start quest scheduler task (only if quests enabled)
      const questsEnabled = config.quests?.enabled !== false;
      if (questsEnabled) {
        startQuestScheduler(client);
        logger.info('Quest scheduler enabled and started');
      } else {
        logger.info('Quest system is DISABLED - scheduler not started');
      }

      // Start role status expiration task
      startRoleStatusExpirationTask();

      // Start tournament round task
      startTournamentRoundTask(client);

      logger.info('All systems initialized and ready');

      // Start memory monitoring (logs every 15 minutes)
      setInterval(() => {
        const usage = process.memoryUsage();
        logger.info('Memory usage:', {
          heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
          rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
        });
      }, 15 * 60 * 1000); // 15 minutes
    });

    // Register shutdown handlers
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error) {
    logger.error('Fatal error during startup:', error);
    process.exit(1);
  }
}

// Start the bot
main();
