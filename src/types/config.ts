/**
 * Configuration types for the bot
 */

export interface BotConfig {
  discord: DiscordConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  bot: BotSettings;
  economy: EconomyConfig;
  gambling: GamblingConfig;
  logging: LoggingConfig;
}

export interface DiscordConfig {
  botToken: string;
  clientId: string;
}

export interface DatabaseConfig {
  uri: string;
  name: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  username?: string;
  password: string;
  tls: boolean;
}

export interface BotSettings {
  commandPrefix: string;
  maxFactionsPerServer: number;
  factionCreateCost: number;
  dailyUpkeepCost: number;
}

export interface EconomyConfig {
  coinsPerSecond: number;
  mutedMultiplier: number;
}

export interface GamblingConfig {
  coinflip: {
    minBet: number;
    maxBet: number;
    houseEdge: number;
  };
  slots: {
    minBet: number;
    maxBet: number;
    houseEdge: number;
  };
}

export interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
}
