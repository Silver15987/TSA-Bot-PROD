import { Client, GatewayIntentBits, Collection, REST, Routes } from 'discord.js';
import { config } from './config';
import logger from './logger';

/**
 * Extended Discord Client with command collection
 */
export class BotClient extends Client {
  public commands: Collection<string, any>;

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
      presence: {
        status: 'online',
        activities: [
          {
            name: 'VC Time Tracking',
            type: 3, // Watching
          },
        ],
      },
    });

    this.commands = new Collection();
  }

  /**
   * Register slash commands globally
   */
  async registerCommands(commands: any[]): Promise<void> {
    try {
      logger.info('Registering slash commands...');

      const rest = new REST({ version: '10' }).setToken(config.discord.botToken);

      await rest.put(Routes.applicationCommands(config.discord.clientId), {
        body: commands,
      });

      logger.info(`Successfully registered ${commands.length} slash commands`);
    } catch (error) {
      logger.error('Failed to register slash commands:', error);
      throw error;
    }
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting Discord bot...');
      await this.login(config.discord.botToken);
    } catch (error) {
      logger.error('Failed to start bot:', error);
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    logger.info('Stopping Discord bot...');
    this.destroy();
  }
}
