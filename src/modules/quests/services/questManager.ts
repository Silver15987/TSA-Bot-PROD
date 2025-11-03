import { database } from '../../../database/client';
import { QuestDocument } from '../../../types/database';
import logger from '../../../core/logger';
import { QuestCreationResult, QuestTemplateData, QuestStatus } from '../types';

/**
 * Quest Manager
 * Handles database operations for quests
 */
export class QuestManager {
  /**
   * Create a quest template
   */
  async createQuestTemplate(
    guildId: string,
    createdBy: string,
    templateData: QuestTemplateData
  ): Promise<QuestCreationResult> {
    try {
      const questId = this.generateQuestId();
      const now = new Date();

      const questDoc: QuestDocument = {
        id: questId,
        factionId: null, // Templates have no faction
        guildId,
        type: templateData.type,
        name: templateData.name,
        description: templateData.description,
        difficulty: 'easy', // Will be set when assigned to faction
        goal: templateData.baseGoal,
        baseGoal: templateData.baseGoal,
        currentProgress: 0,
        durationHours: templateData.durationHours,
        acceptanceWindowHours: 3, // Default 3 hours
        treasuryReward: templateData.treasuryReward,
        questXp: templateData.questXp || 500, // Default 500 XP
        topContributorRewards: {
          first: templateData.firstPlaceReward,
          second: templateData.secondPlaceReward,
          third: templateData.thirdPlaceReward,
        },
        participationReward: templateData.participationReward,
        bonusEffect: templateData.bonusEffect,
        status: 'template',
        isTemplate: true,
        createdAt: now,
        offeredAt: null,
        acceptanceDeadline: null,
        acceptedAt: null,
        questDeadline: null,
        completedAt: null,
        contributorStats: {},
        createdBy,
        updatedAt: now,
      };

      await database.quests.insertOne(questDoc);
      logger.info(`Created quest template "${templateData.name}" (${questId}) for guild ${guildId}`);

      return {
        success: true,
        questId,
      };
    } catch (error) {
      logger.error(`Failed to create quest template "${templateData.name}":`, error);
      return {
        success: false,
        error: 'Database error occurred while creating quest template',
      };
    }
  }

  /**
   * Get all quest templates for a guild
   */
  async getQuestTemplates(guildId: string): Promise<QuestDocument[]> {
    try {
      return await database.quests
        .find({ guildId, isTemplate: true, status: 'template' })
        .toArray();
    } catch (error) {
      logger.error(`Failed to get quest templates for guild ${guildId}:`, error);
      return [];
    }
  }

  /**
   * Get quest by ID
   */
  async getQuestById(questId: string, guildId: string): Promise<QuestDocument | null> {
    try {
      return await database.quests.findOne({ id: questId, guildId });
    } catch (error) {
      logger.error(`Failed to get quest ${questId}:`, error);
      return null;
    }
  }

  /**
   * Get active quest for a faction (offered or active status)
   */
  async getActiveQuest(factionId: string, guildId: string): Promise<QuestDocument | null> {
    try {
      return await database.quests.findOne({
        factionId,
        guildId,
        status: { $in: ['offered', 'active'] },
      });
    } catch (error) {
      logger.error(`Failed to get active quest for faction ${factionId}:`, error);
      return null;
    }
  }

  /**
   * Get faction quest history
   */
  async getFactionQuestHistory(
    factionId: string,
    guildId: string,
    limit: number = 10
  ): Promise<QuestDocument[]> {
    try {
      return await database.quests
        .find({
          factionId,
          guildId,
          status: { $in: ['completed', 'failed', 'expired'] },
        })
        .sort({ completedAt: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      logger.error(`Failed to get quest history for faction ${factionId}:`, error);
      return [];
    }
  }

  /**
   * Update quest status
   */
  async updateQuestStatus(
    questId: string,
    guildId: string,
    status: QuestStatus
  ): Promise<boolean> {
    try {
      const updateData: any = {
        $set: {
          status,
          updatedAt: new Date(),
        },
      };

      // Set completedAt if completing
      if (['completed', 'failed', 'expired', 'rejected'].includes(status)) {
        updateData.$set.completedAt = new Date();
      }

      const result = await database.quests.updateOne(
        { id: questId, guildId },
        updateData
      );

      return result.modifiedCount > 0;
    } catch (error) {
      logger.error(`Failed to update quest status for ${questId}:`, error);
      return false;
    }
  }

  /**
   * Update quest progress
   */
  async updateQuestProgress(
    questId: string,
    guildId: string,
    newProgress: number
  ): Promise<boolean> {
    try {
      const result = await database.quests.updateOne(
        { id: questId, guildId },
        {
          $set: {
            currentProgress: newProgress,
            updatedAt: new Date(),
          },
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      logger.error(`Failed to update quest progress for ${questId}:`, error);
      return false;
    }
  }

  /**
   * Add or update contributor stats
   */
  async updateContributorStats(
    questId: string,
    guildId: string,
    userId: string,
    contribution: number
  ): Promise<boolean> {
    try {
      const result = await database.quests.updateOne(
        { id: questId, guildId },
        {
          $set: {
            [`contributorStats.${userId}`]: {
              userId,
              contribution,
            },
            updatedAt: new Date(),
          },
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      logger.error(`Failed to update contributor stats for ${questId}:`, error);
      return false;
    }
  }

  /**
   * Delete quest template
   */
  async deleteQuestTemplate(questId: string, guildId: string): Promise<boolean> {
    try {
      const result = await database.quests.deleteOne({
        id: questId,
        guildId,
        isTemplate: true,
        status: 'template',
      });

      if (result.deletedCount > 0) {
        logger.info(`Deleted quest template ${questId} from guild ${guildId}`);
        return true;
      }

      logger.warn(`Quest template ${questId} not found for deletion`);
      return false;
    } catch (error) {
      logger.error(`Failed to delete quest template ${questId}:`, error);
      return false;
    }
  }

  /**
   * Get all quests by status for a guild
   */
  async getQuestsByStatus(guildId: string, status: QuestStatus): Promise<QuestDocument[]> {
    try {
      return await database.quests.find({ guildId, status }).toArray();
    } catch (error) {
      logger.error(`Failed to get quests by status for guild ${guildId}:`, error);
      return [];
    }
  }

  /**
   * Generate unique quest ID
   */
  private generateQuestId(): string {
    return `quest_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

export const questManager = new QuestManager();
