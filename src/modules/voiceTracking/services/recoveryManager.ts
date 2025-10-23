import { ChannelType } from 'discord.js';
import { BotClient } from '../../../core/client';
import { sessionManager } from './sessionManager';
import { categoryValidator } from './categoryValidator';
import logger from '../../../core/logger';

/**
 * Recovery Manager
 * Recovers active VC sessions after bot restart
 */
export class RecoveryManager {
  /**
   * Recover all active sessions on bot startup
   */
  async recoverActiveSessions(client: BotClient): Promise<void> {
    logger.info('Starting VC session recovery after bot restart...');

    let recoveredCount = 0;

    try {
      for (const guild of client.guilds.cache.values()) {
        try {
          if (!categoryValidator.isTrackingEnabled(guild.id)) {
            continue;
          }

          const trackedCategoryId = categoryValidator.getTrackedCategoryId(guild.id);
          const category = await guild.channels.fetch(trackedCategoryId).catch(() => null);

          if (!category || category.type !== ChannelType.GuildCategory) {
            logger.warn(
              `Tracked category ${trackedCategoryId} not found or invalid in guild ${guild.id}`
            );
            continue;
          }

          const voiceChannels = guild.channels.cache.filter(
            (ch) =>
              ch.type === ChannelType.GuildVoice &&
              ch.parentId === trackedCategoryId
          );

          for (const channel of voiceChannels.values()) {
            if (channel.type !== ChannelType.GuildVoice) continue;

            for (const member of channel.members.values()) {
              if (member.user.bot) continue;

              const existingSession = await sessionManager.hasActiveSession(member.id, guild.id);

              if (existingSession) {
                logger.debug(`Session already exists for user ${member.id}, skipping recovery`);
                continue;
              }

              await sessionManager.createSession(member.id, guild.id, channel.id);
              recoveredCount++;

              logger.debug(`Recovered session for user ${member.id} in channel ${channel.id}`);
            }
          }
        } catch (error) {
          logger.error(`Failed to recover sessions for guild ${guild.id}:`, error);
        }
      }

      logger.info(`Session recovery complete: ${recoveredCount} sessions recovered`);
    } catch (error) {
      logger.error('Error during session recovery:', error);
    }
  }

  /**
   * Verify session integrity (check if Redis sessions match actual VC state)
   */
  async verifySessionIntegrity(client: BotClient): Promise<{
    valid: number;
    invalid: number;
    cleaned: number;
  }> {
    logger.info('Verifying session integrity...');

    let validCount = 0;
    let invalidCount = 0;
    let cleanedCount = 0;

    try {
      for (const guild of client.guilds.cache.values()) {
        if (!categoryValidator.isTrackingEnabled(guild.id)) {
          continue;
        }

        const sessions = await sessionManager.getAllActiveSessions(guild.id);

        for (const session of sessions) {
          try {
            const member = await guild.members.fetch(session.userId).catch(() => null);

            if (!member || !member.voice.channelId) {
              logger.warn(`Invalid session: User ${session.userId} not in VC`);
              await sessionManager.deleteSession(session.userId, guild.id);
              invalidCount++;
              cleanedCount++;
              continue;
            }

            if (member.voice.channelId !== session.channelId) {
              logger.warn(
                `Invalid session: Channel mismatch for user ${session.userId}` +
                `(Expected: ${session.channelId}, Actual: ${member.voice.channelId})`
              );
              await sessionManager.deleteSession(session.userId, guild.id);
              invalidCount++;
              cleanedCount++;
              continue;
            }

            const isTrackable = await categoryValidator.isTrackableChannel(
              session.channelId,
              guild.id,
              client
            );

            if (!isTrackable) {
              logger.warn(`Invalid session: User ${session.userId} in non-trackable channel`);
              await sessionManager.deleteSession(session.userId, guild.id);
              invalidCount++;
              cleanedCount++;
              continue;
            }

            validCount++;
          } catch (error) {
            logger.error(`Failed to verify session for user ${session.userId}:`, error);
          }
        }
      }

      logger.info(
        `Session integrity check complete: ${validCount} valid, ${invalidCount} invalid, ${cleanedCount} cleaned`
      );

      return { valid: validCount, invalid: invalidCount, cleaned: cleanedCount };
    } catch (error) {
      logger.error('Error during session integrity check:', error);
      return { valid: 0, invalid: 0, cleaned: 0 };
    }
  }
}

export const recoveryManager = new RecoveryManager();
