import { database } from '../../../database/client';
import { QuestDocument, FactionDocument } from '../../../types/database';
import { Client, EmbedBuilder, TextChannel, NewsChannel, VoiceChannel } from 'discord.js';
import logger from '../../../core/logger';
import { configManager } from '../../../core/configManager';
import { questManager } from './questManager';
import { questCooldownManager } from './questCooldownManager';
import { questValidators } from './questValidators';
import { calculateDifficulty, scaleQuestGoal, getDifficultyEmoji, getDifficultyLabel } from '../utils/difficultyScaler';
import { formatQuestGoal, formatBonusEffect, formatQuestType } from '../utils/questFormatters';
import { QuestOperationResult } from '../types';

/**
 * Quest Assignment Service
 * Handles assigning quests to factions
 */
export class QuestAssignmentService {
  /**
   * Assign a random quest from template pool to a faction
   */
  async assignRandomQuestToFaction(
    client: Client,
    factionId: string,
    guildId: string
  ): Promise<QuestOperationResult> {
    try {
      // Validate faction can receive quest
      const validation = await questValidators.canReceiveQuest(factionId, guildId);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
        };
      }

      // Check if faction is on cooldown
      const isOnCooldown = await questCooldownManager.isOnCooldown(factionId);
      if (isOnCooldown) {
        const remaining = await questCooldownManager.getRemainingCooldown(factionId);
        return {
          success: false,
          error: `Faction is on cooldown. Wait ${Math.ceil(remaining / (1000 * 60))} minutes before receiving another quest.`,
        };
      }

      // Check if faction already has an active quest
      const existingQuest = await questManager.getActiveQuest(factionId, guildId);
      if (existingQuest) {
        return {
          success: false,
          error: 'Faction already has an active or offered quest',
        };
      }

      // Get all quest templates for this guild
      const templates = await questManager.getQuestTemplates(guildId);

      if (templates.length === 0) {
        return {
          success: false,
          error: 'No quest templates available. Please create quest templates first.',
        };
      }

      // Pick a random template
      const randomTemplate = templates[Math.floor(Math.random() * templates.length)];

      // Get faction details
      const faction = await database.factions.findOne({ id: factionId, guildId });
      if (!faction) {
        return {
          success: false,
          error: 'Faction not found',
        };
      }

      // Calculate difficulty based on faction size
      const memberCount = faction.members.length;
      const difficulty = calculateDifficulty(memberCount, guildId);

      // Scale quest goal based on difficulty
      const scaledGoal = scaleQuestGoal(
        randomTemplate.baseGoal,
        difficulty,
        randomTemplate.type,
        guildId
      );

      // Create quest instance from template
      const config = configManager.getConfig(guildId);
      const now = new Date();
      const acceptanceDeadline = new Date(
        now.getTime() + config.quests.acceptanceWindowHours * 60 * 60 * 1000
      );

      const questId = this.generateQuestId();

      // Exclude _id from template to avoid duplicate key error
      const { _id, ...templateData } = randomTemplate;

      const questDoc: QuestDocument = {
        ...templateData,
        id: questId,
        factionId, // Assign to faction
        difficulty, // Set difficulty
        goal: scaledGoal, // Use scaled goal
        currentProgress: 0,
        status: 'offered',
        isTemplate: false,
        offeredAt: now,
        acceptanceDeadline,
        acceptedAt: null,
        questDeadline: null,
        completedAt: null,
        contributorStats: {},
        createdAt: now,
        updatedAt: now,
      };

      // Save quest to database
      await database.quests.insertOne(questDoc);

      // Send quest offer to faction channel
      await this.sendQuestOffer(client, faction, questDoc, guildId);

      logger.info(
        `Assigned quest "${questDoc.name}" to faction ${faction.name} (${factionId}) with ${difficulty} difficulty`
      );

      return {
        success: true,
        message: `Quest "${questDoc.name}" has been offered to ${faction.name}`,
      };
    } catch (error) {
      logger.error(`Failed to assign random quest to faction ${factionId}:`, error);
      return {
        success: false,
        error: 'An error occurred while assigning quest',
      };
    }
  }

  /**
   * Manually assign a specific quest template to a faction (admin command)
   */
  async assignSpecificQuest(
    client: Client,
    templateId: string,
    factionId: string,
    guildId: string,
    overrideCooldown: boolean = true
  ): Promise<QuestOperationResult> {
    try {
      // Get template
      const template = await questManager.getQuestById(templateId, guildId);
      if (!template || !template.isTemplate) {
        return {
          success: false,
          error: 'Quest template not found',
        };
      }

      // Validate faction
      const validation = await questValidators.canReceiveQuest(factionId, guildId);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
        };
      }

      // Check cooldown unless overriding
      if (!overrideCooldown) {
        const isOnCooldown = await questCooldownManager.isOnCooldown(factionId);
        if (isOnCooldown) {
          return {
            success: false,
            error: 'Faction is on cooldown',
          };
        }
      }

      // Check existing quest
      const existingQuest = await questManager.getActiveQuest(factionId, guildId);
      if (existingQuest) {
        return {
          success: false,
          error: 'Faction already has an active or offered quest',
        };
      }

      // Get faction details
      const faction = await database.factions.findOne({ id: factionId, guildId });
      if (!faction) {
        return {
          success: false,
          error: 'Faction not found',
        };
      }

      // Calculate difficulty and scale goal
      const memberCount = faction.members.length;
      const difficulty = calculateDifficulty(memberCount, guildId);
      const scaledGoal = scaleQuestGoal(template.baseGoal, difficulty, template.type, guildId);

      // Create quest instance
      const config = configManager.getConfig(guildId);
      const now = new Date();
      const acceptanceDeadline = new Date(
        now.getTime() + config.quests.acceptanceWindowHours * 60 * 60 * 1000
      );

      const questId = this.generateQuestId();

      // Exclude _id from template to avoid duplicate key error
      const { _id, ...templateData } = template;

      const questDoc: QuestDocument = {
        ...templateData,
        id: questId,
        factionId,
        difficulty,
        goal: scaledGoal,
        currentProgress: 0,
        status: 'offered',
        isTemplate: false,
        offeredAt: now,
        acceptanceDeadline,
        acceptedAt: null,
        questDeadline: null,
        completedAt: null,
        contributorStats: {},
        createdAt: now,
        updatedAt: now,
      };

      await database.quests.insertOne(questDoc);

      // Clear cooldown if overriding
      if (overrideCooldown) {
        await questCooldownManager.clearCooldown(factionId);
      }

      // Send quest offer
      await this.sendQuestOffer(client, faction, questDoc, guildId);

      logger.info(
        `Manually assigned quest "${questDoc.name}" to faction ${faction.name} (${factionId})`
      );

      return {
        success: true,
        message: `Quest "${questDoc.name}" has been assigned to ${faction.name}`,
      };
    } catch (error) {
      logger.error(`Failed to assign specific quest ${templateId} to faction ${factionId}:`, error);
      return {
        success: false,
        error: 'An error occurred while assigning quest',
      };
    }
  }

  /**
   * Send quest offer embed to faction channel
   */
  private async sendQuestOffer(
    client: Client,
    faction: FactionDocument,
    quest: QuestDocument,
    guildId: string
  ): Promise<void> {
    try {
      const channel = await client.channels.fetch(faction.channelId);

      if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel || channel instanceof VoiceChannel)) {
        logger.warn(`Could not send quest offer: faction channel not found or invalid`);
        return;
      }

      const difficultyEmoji = getDifficultyEmoji(quest.difficulty);
      const difficultyLabel = getDifficultyLabel(quest.difficulty);
      const typeLabel = formatQuestType(quest.type);
      const goalText = formatQuestGoal(quest.type, quest.goal);
      const bonusText = formatBonusEffect(quest.bonusEffect);

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('📜 NEW QUEST AVAILABLE')
        .setDescription(
          `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n` +
            `┃  **${quest.name}**\n` +
            `┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
            quest.description
        )
        .addFields(
          {
            name: `${difficultyEmoji} Difficulty`,
            value: difficultyLabel,
            inline: true,
          },
          {
            name: '📋 Type',
            value: typeLabel,
            inline: true,
          },
          {
            name: '🎯 Goal',
            value: goalText,
            inline: true,
          },
          {
            name: '⏱️ Duration',
            value: `${quest.durationHours} hours (after acceptance)`,
            inline: true,
          },
          {
            name: '⏰ Time to Accept',
            value: `${quest.acceptanceWindowHours} hours`,
            inline: true,
          },
          {
            name: '\u200B',
            value: '\u200B',
            inline: true,
          }
        )
        .addFields({
          name: '💰 Rewards',
          value:
            `**Treasury:** ${quest.treasuryReward.toLocaleString()} coins\n` +
            `**🏆 Top 3 Contributors:**\n` +
            `  🥇 1st: ${quest.topContributorRewards.first} coins\n` +
            `  🥈 2nd: ${quest.topContributorRewards.second} coins\n` +
            `  🥉 3rd: ${quest.topContributorRewards.third} coins\n` +
            `**👥 Participation:** ${quest.participationReward} coins each\n` +
            `**✨ Bonus:** ${bonusText}`,
        })
        .addFields({
          name: '📝 How to Accept',
          value: `Use \`/quest accept\` to begin this quest!\n(Only Wardens and Overseers can accept)`,
        })
        .setFooter({
          text: `Offer expires: ${quest.acceptanceDeadline?.toLocaleString() || 'Unknown'}`,
        })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (error) {
      logger.error(`Failed to send quest offer to faction ${faction.id}:`, error);
    }
  }

  /**
   * Generate unique quest ID
   */
  private generateQuestId(): string {
    return `quest_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

export const questAssignmentService = new QuestAssignmentService();
