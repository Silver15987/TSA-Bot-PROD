import { database } from '../../../database/client';
import { questManager } from './questManager';
import { questValidators } from './questValidators';
import logger from '../../../core/logger';

/**
 * Quest Progress Tracker
 * Tracks and updates progress for active quests
 */
export class QuestProgressTracker {
  /**
   * Track VC time contribution for a user
   */
  async trackVcTimeContribution(
    userId: string,
    guildId: string,
    factionId: string,
    duration: number
  ): Promise<void> {
    try {
      // Get active quest for faction
      const quest = await questManager.getActiveQuest(factionId, guildId);

      if (!quest || quest.status !== 'active') {
        return; // No active quest
      }

      // Only track if quest is VC time type
      if (quest.type !== 'collective_vc_time') {
        return;
      }

      // Validate progress update
      const validation = questValidators.validateProgressUpdate(quest, duration);
      if (!validation.valid) {
        logger.warn(`Invalid progress update for quest ${quest.id}: ${validation.error}`);
        return;
      }

      // Update contributor stats
      const existingContribution = quest.contributorStats[userId]?.contribution || 0;
      const newContribution = existingContribution + duration;

      await questManager.updateContributorStats(quest.id, guildId, userId, newContribution);

      // Update overall progress
      const newProgress = quest.currentProgress + duration;
      await questManager.updateQuestProgress(quest.id, guildId, newProgress);

      logger.info(
        `Updated VC time contribution for user ${userId} in quest ${quest.id}: +${Math.floor(
          duration / 1000
        )}s`
      );

      // Check if quest is completed
      await this.checkQuestCompletion(quest.id, guildId, newProgress, quest.goal);
    } catch (error) {
      logger.error(`Error tracking VC time contribution for user ${userId}:`, error);
    }
  }

  /**
   * Track treasury deposit contribution for a user
   */
  async trackTreasuryContribution(
    userId: string,
    guildId: string,
    factionId: string,
    amount: number
  ): Promise<void> {
    try {
      // Get active quest for faction
      const quest = await questManager.getActiveQuest(factionId, guildId);

      if (!quest || quest.status !== 'active') {
        return; // No active quest
      }

      // Only track if quest is treasury deposit type
      if (quest.type !== 'treasury_deposit') {
        return;
      }

      // Validate progress update
      const validation = questValidators.validateProgressUpdate(quest, amount);
      if (!validation.valid) {
        logger.warn(`Invalid progress update for quest ${quest.id}: ${validation.error}`);
        return;
      }

      // Update contributor stats
      const existingContribution = quest.contributorStats[userId]?.contribution || 0;
      const newContribution = existingContribution + amount;

      await questManager.updateContributorStats(quest.id, guildId, userId, newContribution);

      // Update overall progress
      const newProgress = quest.currentProgress + amount;
      await questManager.updateQuestProgress(quest.id, guildId, newProgress);

      logger.info(
        `Updated treasury contribution for user ${userId} in quest ${quest.id}: +${amount} coins`
      );

      // Check if quest is completed
      await this.checkQuestCompletion(quest.id, guildId, newProgress, quest.goal);
    } catch (error) {
      logger.error(`Error tracking treasury contribution for user ${userId}:`, error);
    }
  }

  /**
   * Track member participation (unique users who contributed)
   */
  async trackMemberParticipation(factionId: string, guildId: string): Promise<void> {
    try {
      // Get active quest for faction
      const quest = await questManager.getActiveQuest(factionId, guildId);

      if (!quest || quest.status !== 'active') {
        return;
      }

      // Only track if quest is member participation type
      if (quest.type !== 'member_participation') {
        return;
      }

      // Get faction
      const faction = await database.factions.findOne({ id: factionId, guildId });
      if (!faction) {
        return;
      }

      // Calculate participation percentage
      const totalMembers = faction.members.length;
      const participatingMembers = Object.keys(quest.contributorStats).length;
      const participationPercent = (participatingMembers / totalMembers) * 100;

      // Update progress
      await questManager.updateQuestProgress(quest.id, guildId, participationPercent);

      logger.info(
        `Updated member participation for quest ${quest.id}: ${participatingMembers}/${totalMembers} (${participationPercent.toFixed(
          1
        )}%)`
      );

      // Check if quest is completed
      await this.checkQuestCompletion(quest.id, guildId, participationPercent, quest.goal);
    } catch (error) {
      logger.error(`Error tracking member participation for faction ${factionId}:`, error);
    }
  }

  /**
   * Check if quest goal has been reached
   */
  private async checkQuestCompletion(
    questId: string,
    guildId: string,
    currentProgress: number,
    goal: number
  ): Promise<void> {
    try {
      if (currentProgress >= goal) {
        // Quest goal reached!
        logger.info(`Quest ${questId} goal reached! Progress: ${currentProgress}/${goal}`);

        // Get quest (still in 'active' status)
        const quest = await questManager.getQuestById(questId, guildId);
        if (!quest) {
          logger.error(`Quest ${questId} not found for completion`);
          return;
        }

        // Import service dynamically to avoid circular dependencies
        const { questRewardService } = await import('./questRewardService');

        // Distribute rewards FIRST (can throw if error occurs)
        await questRewardService.distributeRewards(quest, guildId);

        // Only mark as completed if rewards were successfully distributed
        await questManager.updateQuestStatus(questId, guildId, 'completed');

        logger.info(`Quest ${questId} completed successfully with all rewards distributed`);

        // Note: Announcement will be sent by the scheduler task
        // when it detects the completed quest
      }
    } catch (error) {
      logger.error(`Error checking quest completion for ${questId}:`, error);
      logger.error(`Quest remains in active state and can be retried`);
      // Propagate error so calling code knows completion failed
      throw error;
    }
  }

  /**
   * Manually update quest progress (for testing or admin commands)
   */
  async manualProgressUpdate(
    questId: string,
    guildId: string,
    userId: string,
    contributionAmount: number
  ): Promise<boolean> {
    try {
      const quest = await questManager.getQuestById(questId, guildId);

      if (!quest || quest.status !== 'active') {
        logger.warn(`Cannot update progress: quest ${questId} is not active`);
        return false;
      }

      // Update contributor stats
      const existingContribution = quest.contributorStats[userId]?.contribution || 0;
      const newContribution = existingContribution + contributionAmount;

      await questManager.updateContributorStats(quest.id, guildId, userId, newContribution);

      // Update overall progress
      const newProgress = quest.currentProgress + contributionAmount;
      await questManager.updateQuestProgress(quest.id, guildId, newProgress);

      // Check completion
      await this.checkQuestCompletion(quest.id, guildId, newProgress, quest.goal);

      return true;
    } catch (error) {
      logger.error(`Error in manual progress update for quest ${questId}:`, error);
      return false;
    }
  }
}

export const questProgressTracker = new QuestProgressTracker();
