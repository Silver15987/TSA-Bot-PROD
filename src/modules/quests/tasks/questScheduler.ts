import { Client } from 'discord.js';
import { database } from '../../../database/client';
import { configManager } from '../../../core/configManager';
import { questManager } from '../services/questManager';
import { questAssignmentService } from '../services/questAssignmentService';
import { questCooldownManager } from '../services/questCooldownManager';
import { questRewardService } from '../services/questRewardService';
import { factionManager } from '../../factions/services/factionManager';
import logger from '../../../core/logger';

let questSchedulerInterval: NodeJS.Timeout | null = null;

/**
 * Start the quest scheduler task
 * Handles automatic quest assignment, expiration, and deadline checking
 */
export function startQuestScheduler(client: Client): void {
  if (questSchedulerInterval) {
    logger.warn('Quest scheduler already running');
    return;
  }

  logger.info('Starting quest scheduler task...');

  // Run immediately on start
  runQuestScheduler(client);

  // Run every 30 minutes
  questSchedulerInterval = setInterval(() => {
    runQuestScheduler(client);
  }, 30 * 60 * 1000); // 30 minutes

  logger.info('Quest scheduler task started (runs every 30 minutes)');
}

/**
 * Stop the quest scheduler task
 */
export function stopQuestScheduler(): void {
  if (questSchedulerInterval) {
    clearInterval(questSchedulerInterval);
    questSchedulerInterval = null;
    logger.info('Quest scheduler task stopped');
  }
}

/**
 * Run quest scheduler logic
 * Optimized for single-guild operation
 */
async function runQuestScheduler(client: Client): Promise<void> {
  try {
    logger.info('Running quest scheduler...');

    // Get the single guild (optimized for single-guild operation)
    const guild = client.guilds.cache.first();
    if (!guild) {
      logger.warn('Quest scheduler: Bot is not in any guilds, skipping');
      return;
    }

    try {
      // Check if config is loaded, skip if not
      if (!configManager.hasConfig()) {
        logger.warn(`Quest scheduler: Config not loaded for guild ${guild.id}, skipping`);
        return;
      }

      const config = configManager.getConfig();

      // Skip if quests config is missing or disabled
      if (!config.quests || !config.quests.enabled) {
        logger.debug(`Quest scheduler: Quests disabled or not configured for guild ${guild.id}`);
        return;
      }

      // Check quest deadlines
      await checkQuestDeadlines(client, guild.id);

      // Check acceptance deadlines
      await checkAcceptanceDeadlines(guild.id);

      // Auto-assign quests if enabled
      if (config.quests.autoAssignEnabled) {
        await autoAssignQuests(client, guild.id);
      }

      // Clean up expired cooldowns
      await questCooldownManager.cleanupExpiredCooldowns();

      // Send announcements for newly completed quests
      await sendPendingAnnouncements(client, guild.id);
    } catch (error) {
      logger.error(`Error in quest scheduler for guild ${guild.id}:`, error);
    }

    logger.info('Quest scheduler run completed');
  } catch (error) {
    logger.error('Error in quest scheduler:', error);
  }
}

/**
 * Check quest deadlines and mark failed quests
 */
async function checkQuestDeadlines(client: Client, guildId: string): Promise<void> {
  try {
    const activeQuests = await questManager.getQuestsByStatus(guildId, 'active');

    const now = new Date();

    for (const quest of activeQuests) {
      if (quest.questDeadline && now > quest.questDeadline) {
        // Quest deadline passed - mark as failed
        await questManager.updateQuestStatus(quest.id, guildId, 'failed');

        logger.info(`Quest ${quest.id} (${quest.name}) marked as failed - deadline passed`);

        // Send notification to faction channel
        if (quest.factionId) {
          await sendFailureNotification(client, quest, guildId);
        }
      }
    }
  } catch (error) {
    logger.error(`Error checking quest deadlines for guild ${guildId}:`, error);
  }
}

/**
 * Check acceptance deadlines and mark expired quests
 */
async function checkAcceptanceDeadlines(guildId: string): Promise<void> {
  try {
    const offeredQuests = await questManager.getQuestsByStatus(guildId, 'offered');

    const now = new Date();

    for (const quest of offeredQuests) {
      if (quest.acceptanceDeadline && now > quest.acceptanceDeadline) {
        // Acceptance deadline passed - mark as expired
        await questManager.updateQuestStatus(quest.id, guildId, 'expired');

        logger.info(
          `Quest ${quest.id} (${quest.name}) marked as expired - acceptance deadline passed`
        );

        // Set cooldown for faction
        if (quest.factionId) {
          await questCooldownManager.setCooldown(quest.factionId, guildId, quest.id);
        }
      }
    }
  } catch (error) {
    logger.error(`Error checking acceptance deadlines for guild ${guildId}:`, error);
  }
}

/**
 * Auto-assign quests to factions that don't have one
 */
async function autoAssignQuests(client: Client, guildId: string): Promise<void> {
  try {
    // Get all active (non-disbanded) factions
    const factions = await factionManager.getAllFactions(guildId);

    for (const faction of factions) {
      // Check if faction has an active quest
      const existingQuest = await questManager.getActiveQuest(faction.id, guildId);

      if (existingQuest) {
        continue; // Already has a quest
      }

      // Check if faction is on cooldown
      const isOnCooldown = await questCooldownManager.isOnCooldown(faction.id);

      if (isOnCooldown) {
        continue; // On cooldown
      }

      // Assign random quest
      const result = await questAssignmentService.assignRandomQuestToFaction(
        client,
        faction.id,
        guildId
      );

      if (result.success) {
        logger.info(`Auto-assigned quest to faction ${faction.name} (${faction.id})`);
      } else {
        logger.warn(`Failed to auto-assign quest to faction ${faction.name}: ${result.error}`);
      }
    }
  } catch (error) {
    logger.error(`Error auto-assigning quests for guild ${guildId}:`, error);
  }
}

/**
 * Send failure notification to faction channel
 */
async function sendFailureNotification(
  client: Client,
  quest: any,
  guildId: string
): Promise<void> {
  try {
    const faction = await factionManager.getFactionById(quest.factionId, guildId);

    if (!faction) {
      return;
    }

    const channel = await client.channels.fetch(faction.channelId);

    if (!channel || !channel.isTextBased()) {
      return;
    }

    const progressPercent = ((quest.currentProgress / quest.goal) * 100).toFixed(1);

    await (channel as any).send({
      content: `❌ **Quest Failed:** ${quest.name}\n\nYour faction ran out of time! You reached ${progressPercent}% of the goal.\n\nBetter luck next time! A new quest will be available soon.`,
    });
  } catch (error) {
    logger.error(`Error sending failure notification for quest ${quest.id}:`, error);
  }
}

/**
 * Send pending announcements for completed quests
 */
async function sendPendingAnnouncements(client: Client, guildId: string): Promise<void> {
  try {
    // Get recently completed quests (completed in last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const completedQuests = await database.quests
      .find({
        guildId,
        status: 'completed',
        completedAt: { $gte: oneHourAgo },
      })
      .toArray();

    for (const quest of completedQuests) {
      // Send announcement
      await questRewardService.sendCompletionAnnouncement(client, quest, guildId);
    }
  } catch (error) {
    logger.error(`Error sending pending announcements for guild ${guildId}:`, error);
  }
}
