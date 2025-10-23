import dotenv from 'dotenv';
import { BotConfig } from '../types/config';

// Load environment variables
dotenv.config();

/**
 * Validate required environment variables
 */
function validateEnv(): void {
  // DIAGNOSTIC LOGGING - Will appear in Azure Log Stream
  console.log('\n=== ENVIRONMENT VARIABLE DIAGNOSTIC ===');
  console.log('Current working directory:', process.cwd());
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('Total env variables count:', Object.keys(process.env).length);
  console.log('All environment variable keys:', Object.keys(process.env).sort());

  // Check each required variable individually
  console.log('\n--- Required Variables Check ---');
  console.log('DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN ? 'EXISTS (length: ' + process.env.DISCORD_BOT_TOKEN.length + ')' : 'MISSING');
  console.log('DISCORD_CLIENT_ID:', process.env.DISCORD_CLIENT_ID ? 'EXISTS' : 'MISSING');
  console.log('COSMOS_DB_URI:', process.env.COSMOS_DB_URI ? 'EXISTS (length: ' + process.env.COSMOS_DB_URI.length + ')' : 'MISSING');
  console.log('COSMOS_DB_NAME:', process.env.COSMOS_DB_NAME ? 'EXISTS' : 'MISSING');
  console.log('REDIS_HOST:', process.env.REDIS_HOST ? 'EXISTS' : 'MISSING');
  console.log('REDIS_PORT:', process.env.REDIS_PORT ? 'EXISTS' : 'MISSING');
  console.log('REDIS_PASSWORD:', process.env.REDIS_PASSWORD ? 'EXISTS (length: ' + process.env.REDIS_PASSWORD.length + ')' : 'MISSING');
  console.log('======================================\n');

  const required = [
    'DISCORD_BOT_TOKEN',
    'DISCORD_CLIENT_ID',
    'COSMOS_DB_URI',
    'COSMOS_DB_NAME',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file and ensure all required variables are set.'
    );
  }
}

/**
 * Parse and validate configuration from environment variables
 */
export function loadConfig(): BotConfig {
  // Validate first
  validateEnv();

  const config: BotConfig = {
    discord: {
      botToken: process.env.DISCORD_BOT_TOKEN!,
      clientId: process.env.DISCORD_CLIENT_ID!,
    },
    database: {
      uri: process.env.COSMOS_DB_URI!,
      name: process.env.COSMOS_DB_NAME!,
    },
    redis: {
      host: process.env.REDIS_HOST!,
      port: parseInt(process.env.REDIS_PORT || '6380', 10),
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD!,
      tls: process.env.REDIS_TLS_ENABLED === 'true',
    },
    bot: {
      commandPrefix: process.env.COMMAND_PREFIX || '!',
      maxFactionsPerServer: parseInt(process.env.MAX_FACTIONS_PER_SERVER || '50', 10),
      factionCreateCost: parseInt(process.env.FACTION_CREATE_COST || '10000', 10),
      dailyUpkeepCost: parseInt(process.env.DAILY_UPKEEP_COST || '500', 10),
    },
    economy: {
      coinsPerSecond: parseFloat(process.env.COINS_PER_SECOND || '0.1'),
      mutedMultiplier: parseFloat(process.env.MUTED_MULTIPLIER || '0.5'),
    },
    gambling: {
      coinflip: {
        minBet: parseInt(process.env.COINFLIP_MIN_BET || '100', 10),
        maxBet: parseInt(process.env.COINFLIP_MAX_BET || '50000', 10),
        houseEdge: parseFloat(process.env.COINFLIP_HOUSE_EDGE || '0.02'),
      },
      slots: {
        minBet: parseInt(process.env.SLOTS_MIN_BET || '50', 10),
        maxBet: parseInt(process.env.SLOTS_MAX_BET || '25000', 10),
        houseEdge: parseFloat(process.env.SLOTS_HOUSE_EDGE || '0.05'),
      },
    },
    logging: {
      level: (process.env.LOG_LEVEL as any) || 'info',
    },
  };

  return config;
}

// Export singleton instance
export const config = loadConfig();
