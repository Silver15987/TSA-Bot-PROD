import { Events, VoiceState } from 'discord.js';
import { BotClient } from '../core/client';
import { categoryValidator } from '../modules/voiceTracking/services/categoryValidator';
import { sessionManager } from '../modules/voiceTracking/services/sessionManager';
import { databaseUpdater } from '../modules/voiceTracking/services/databaseUpdater';
import { factionStatsTracker } from '../modules/factions/services/factionStatsTracker';
import logger from '../core/logger';

export default {
  name: Events.VoiceStateUpdate,
  async execute(oldState: VoiceState, newState: VoiceState) {
    try {
      if (newState.member?.user.bot) return;

      const userId = newState.id;
      const guildId = newState.guild.id;
      const username = newState.member?.user.username || oldState.member?.user.username;
      const client = newState.client as BotClient;

      if (!categoryValidator.isTrackingEnabled(guildId)) {
        return;
      }

      const oldChannelId = oldState.channelId;
      const newChannelId = newState.channelId;

      if (!oldChannelId && newChannelId) {
        await handleJoin(userId, guildId, newChannelId, client);
      }
      else if (oldChannelId && !newChannelId) {
        await handleLeave(userId, guildId, oldChannelId, client, username);
      }
      else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
        await handleSwitch(userId, guildId, oldChannelId, newChannelId, client, username);
      }
    } catch (error) {
      logger.error('Error in voiceStateUpdate event:', error);
    }
  },
};

/**
 * Handle user joining a voice channel
 */
async function handleJoin(
  userId: string,
  guildId: string,
  channelId: string,
  client: BotClient
): Promise<void> {
  const isTrackable = await categoryValidator.isTrackableChannel(channelId, guildId, client);

  if (!isTrackable) {
    logger.debug(`User ${userId} joined non-trackable channel ${channelId}`);
    return;
  }

  const existingSession = await sessionManager.hasActiveSession(userId, guildId);

  if (existingSession) {
    logger.warn(`User ${userId} already has an active session, ending it first`);
    await databaseUpdater.saveAndEndSession(userId, guildId);
  }

  // Check if this is a faction VC
  const factionId = await factionStatsTracker.getFactionByChannelId(channelId, guildId);

  await sessionManager.createSession(userId, guildId, channelId, factionId || undefined);
  logger.info(`User ${userId} joined trackable VC ${channelId} in guild ${guildId}${factionId ? ` (faction: ${factionId})` : ''}`);
}

/**
 * Handle user leaving a voice channel
 */
async function handleLeave(
  userId: string,
  guildId: string,
  channelId: string,
  client: BotClient,
  username?: string
): Promise<void> {
  const isTrackable = await categoryValidator.isTrackableChannel(channelId, guildId, client);

  if (!isTrackable) {
    logger.debug(`User ${userId} left non-trackable channel ${channelId}`);
    return;
  }

  const hasSession = await sessionManager.hasActiveSession(userId, guildId);

  if (!hasSession) {
    logger.warn(`User ${userId} left VC but has no active session`);
    return;
  }

  await databaseUpdater.saveAndEndSession(userId, guildId, username);
  logger.info(`User ${userId} left trackable VC ${channelId} in guild ${guildId}`);
}

/**
 * Handle user switching between voice channels
 */
async function handleSwitch(
  userId: string,
  guildId: string,
  oldChannelId: string,
  newChannelId: string,
  client: BotClient,
  username?: string
): Promise<void> {
  const oldTrackable = await categoryValidator.isTrackableChannel(oldChannelId, guildId, client);
  const newTrackable = await categoryValidator.isTrackableChannel(newChannelId, guildId, client);

  if (oldTrackable && !newTrackable) {
    await databaseUpdater.saveAndEndSession(userId, guildId, username);
    logger.info(`User ${userId} switched from trackable to non-trackable channel`);
  }
  else if (!oldTrackable && newTrackable) {
    // Check if new channel is a faction VC
    const factionId = await factionStatsTracker.getFactionByChannelId(newChannelId, guildId);
    await sessionManager.createSession(userId, guildId, newChannelId, factionId || undefined);
    logger.info(`User ${userId} switched from non-trackable to trackable channel${factionId ? ` (faction: ${factionId})` : ''}`);
  }
  else if (oldTrackable && newTrackable) {
    // Check if this is a quick transfer (< 5 seconds) like Join-to-Create
    const existingSession = await sessionManager.getSession(userId, guildId);

    if (existingSession) {
      const sessionAge = Date.now() - existingSession.joinedAt;

      if (sessionAge < 5000) {
        // Quick transfer detected - update existing session instead of ending it
        const factionId = await factionStatsTracker.getFactionByChannelId(newChannelId, guildId);
        await sessionManager.transferSession(userId, guildId, newChannelId, factionId || undefined);
        logger.info(`User ${userId} transferred between channels (< 5s) - session continued${factionId ? ` (new is faction: ${factionId})` : ''}`);
      } else {
        // Normal channel switch - end old session and create new one
        await databaseUpdater.saveAndEndSession(userId, guildId, username);
        const factionId = await factionStatsTracker.getFactionByChannelId(newChannelId, guildId);
        await sessionManager.createSession(userId, guildId, newChannelId, factionId || undefined);
        logger.info(`User ${userId} switched between trackable channels${factionId ? ` (new is faction: ${factionId})` : ''}`);
      }
    } else {
      // No existing session found - create new one
      const factionId = await factionStatsTracker.getFactionByChannelId(newChannelId, guildId);
      await sessionManager.createSession(userId, guildId, newChannelId, factionId || undefined);
      logger.info(`User ${userId} switched to trackable channel (no prior session)${factionId ? ` (faction: ${factionId})` : ''}`);
    }
  }
}
