import { database } from '../../../database/client';
import { QuestDocument, FactionDocument } from '../../../types/database';
import { Client, EmbedBuilder, TextChannel, NewsChannel } from 'discord.js';
import { factionManager } from '../../factions/services/factionManager';
import { factionXpService } from '../../factions/services/factionXpService';
import { configManager } from '../../../core/configManager';
import { QuestRewardCalculation, QuestContributor } from '../types';
import { formatQuestGoal, formatQuestProgress, getRankEmoji } from '../utils/questFormatters';
import logger from '../../../core/logger';

/**
 * Quest Reward Service
 * Handles reward calculation and distribution
 */
export class QuestRewardService {
  /**
   * Calculate rewards for all contributors
   */
  calculateRewards(quest: QuestDocument): QuestRewardCalculation[] {
    const rewards: QuestRewardCalculation[] = [];

    // Get all contributors and sort by contribution (descending)
    const contributors: QuestContributor[] = Object.values(quest.contributorStats).sort(
      (a, b) => b.contribution - a.contribution
    );

    if (contributors.length === 0) {
      return rewards;
    }

    // Assign ranks and rewards
    for (let i = 0; i < contributors.length; i++) {
      const contributor = contributors[i];
      const rank = i + 1;
      let reward = 0;

      if (rank === 1) {
        reward = quest.topContributorRewards.first;
      } else if (rank === 2) {
        reward = quest.topContributorRewards.second;
      } else if (rank === 3) {
        reward = quest.topContributorRewards.third;
      } else {
        reward = quest.participationReward;
      }

      rewards.push({
        userId: contributor.userId,
        contribution: contributor.contribution,
        rank,
        reward,
      });
    }

    return rewards;
  }

  /**
   * Distribute rewards to faction and members
   */
  async distributeRewards(quest: QuestDocument, guildId: string): Promise<boolean> {
    try {
      if (!quest.factionId) {
        logger.error(`Cannot distribute rewards: quest ${quest.id} has no faction`);
        return false;
      }

      // Get faction
      const faction = await factionManager.getFactionById(quest.factionId, guildId);
      if (!faction) {
        logger.error(`Cannot distribute rewards: faction ${quest.factionId} not found`);
        return false;
      }

      // Calculate rewards
      const rewardCalculations = this.calculateRewards(quest);

      // Update quest document with reward info
      const updatedContributorStats: any = {};
      for (const calc of rewardCalculations) {
        updatedContributorStats[calc.userId] = {
          userId: calc.userId,
          contribution: calc.contribution,
          rank: calc.rank,
          reward: calc.reward,
        };
      }

      await database.quests.updateOne(
        { id: quest.id, guildId },
        {
          $set: {
            contributorStats: updatedContributorStats,
            updatedAt: new Date(),
          },
        }
      );

      // Distribute treasury reward
      await database.factions.updateOne(
        { id: faction.id, guildId },
        {
          $inc: { treasury: quest.treasuryReward },
          $set: { updatedAt: new Date() },
        }
      );

      logger.info(
        `Added ${quest.treasuryReward} coins to faction ${faction.name} treasury from quest reward`
      );

      // Award XP to faction (default 500, configurable per quest)
      const questXp = quest.questXp || 500;
      const xpResult = await factionXpService.addXp(
        quest.factionId,
        guildId,
        questXp,
        'quest_completion'
      );

      if (xpResult.success && xpResult.leveledUp) {
        logger.info(
          `Faction ${faction.name} (${quest.factionId}) leveled up to ${xpResult.newLevel} from quest completion!`
        );
      }

      // Distribute individual rewards
      for (const calc of rewardCalculations) {
        await this.distributeIndividualReward(calc.userId, guildId, calc.reward, quest.id);
      }

      // Apply bonus effect if any
      if (quest.bonusEffect) {
        await this.applyBonusEffect(quest.bonusEffect, faction, guildId);
      }

      // Log success summary
      logger.info(`Reward distribution summary for quest ${quest.id}:`);
      logger.info(`  - Quest: "${quest.name}"`);
      logger.info(`  - Faction: ${faction.name} (${faction.id})`);
      logger.info(`  - Treasury: +${quest.treasuryReward} coins`);
      logger.info(`  - XP: +${questXp} XP`);
      logger.info(`  - Individual rewards: ${rewardCalculations.length} users`);
      logger.info(`Successfully distributed all rewards for quest ${quest.id}`);

      return true;
    } catch (error) {
      logger.error(`CRITICAL ERROR distributing rewards for quest ${quest.id}:`, error);
      logger.error(`  - Quest: "${quest.name}"`);
      logger.error(`  - Faction: ${quest.factionId}`);
      logger.error(`  - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Distribute individual reward to a user
   */
  private async distributeIndividualReward(
    userId: string,
    guildId: string,
    amount: number,
    questId: string
  ): Promise<void> {
    try {
      // Get or create user document
      let user = await database.users.findOne({ id: userId, guildId });

      if (!user) {
        logger.warn(`User ${userId} not found, creating user document`);
        // Create minimal user document
        const newUser = {
          id: userId,
          guildId,
          username: 'Unknown',
          discriminator: '0',
          totalVcTime: 0,
          dailyVcTime: 0,
          weeklyVcTime: 0,
          monthlyVcTime: 0,
          coins: amount,
          totalCoinsEarned: amount,
          dailyCoinsEarned: amount,
          weeklyCoinsEarned: amount,
          monthlyCoinsEarned: amount,
          lastActiveDate: new Date(),
          currentStreak: 0,
          longestStreak: 0,
          currentFaction: null,
          factionJoinDate: null,
          factionCoinsDeposited: 0,
          factionVcTime: 0,
          lifetimeFactionVcTime: 0,
          questsCompleted: 1,
          lastDailyReset: new Date(),
          lastWeeklyReset: new Date(),
          lastMonthlyReset: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await database.users.insertOne(newUser);

        // Fetch the inserted user to get the full document with _id
        user = await database.users.findOne({ id: userId, guildId });
        if (!user) {
          throw new Error(`Failed to create user ${userId}`);
        }
      } else {
        // Update existing user
        await database.users.updateOne(
          { id: userId, guildId },
          {
            $inc: {
              coins: amount,
              totalCoinsEarned: amount,
              dailyCoinsEarned: amount,
              weeklyCoinsEarned: amount,
              monthlyCoinsEarned: amount,
              questsCompleted: 1,
            },
            $set: { updatedAt: new Date() },
          }
        );
      }

      // Create transaction record
      // Refetch user to get accurate balance after update
      const updatedUser = await database.users.findOne({ id: userId, guildId });
      if (!updatedUser) {
        throw new Error(`User ${userId} not found after update`);
      }

      await database.transactions.insertOne({
        id: `txn_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
        userId,
        type: 'quest_reward',
        amount,
        balanceAfter: updatedUser.coins,
        metadata: {
          questId,
          source: 'quest_completion',
        },
        createdAt: new Date(),
      });

      logger.info(`Distributed ${amount} coins to user ${userId} from quest ${questId}`);
    } catch (error) {
      logger.error(`Error distributing individual reward to user ${userId}:`, error);
      throw error; // Propagate error to caller
    }
  }

  /**
   * Apply bonus effect to faction
   */
  private async applyBonusEffect(
    bonusEffect: string,
    faction: FactionDocument,
    guildId: string
  ): Promise<void> {
    try {
      switch (bonusEffect) {
        case 'coin_multiplier_2x_24h':
          // TODO: Implement coin multiplier buff
          // This would require storing buff state in Redis or database
          logger.info(`Applied 2x coin multiplier for faction ${faction.id} for 24 hours`);
          break;

        case 'upkeep_forgiven_today':
          // Set next upkeep date to tomorrow + 1 day
          const tomorrow = new Date();
          tomorrow.setUTCDate(tomorrow.getUTCDate() + 2);
          tomorrow.setUTCHours(0, 0, 0, 0);

          await database.factions.updateOne(
            { id: faction.id, guildId },
            {
              $set: {
                nextUpkeepDate: tomorrow,
                updatedAt: new Date(),
              },
            }
          );

          logger.info(`Forgave upkeep for faction ${faction.id}`);
          break;

        default:
          logger.warn(`Unknown bonus effect: ${bonusEffect}`);
      }
    } catch (error) {
      logger.error(`Error applying bonus effect ${bonusEffect}:`, error);
    }
  }

  /**
   * Send quest completion announcement to faction announcement channel
   */
  async sendCompletionAnnouncement(
    client: Client,
    quest: QuestDocument,
    guildId: string
  ): Promise<void> {
    try {
      if (!quest.factionId) {
        return;
      }

      // Get faction
      const faction = await factionManager.getFactionById(quest.factionId, guildId);
      if (!faction) {
        return;
      }

      // Get server config
      const config = configManager.getConfig(guildId);
      const announcementChannelId = config.factions.announcementChannelId;

      if (!announcementChannelId) {
        logger.warn('No announcement channel configured, skipping quest completion announcement');
        return;
      }

      // Fetch channel
      const channel = await client.channels.fetch(announcementChannelId);
      if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
        logger.warn('Announcement channel not found or not a text/news channel');
        return;
      }

      // Get reward calculations
      const rewardCalcs = this.calculateRewards(quest);
      const top3 = rewardCalcs.slice(0, 3);

      // Calculate quest stats
      const progressPercent = ((quest.currentProgress / quest.goal) * 100).toFixed(1);
      const contributorCount = Object.keys(quest.contributorStats).length;

      // Calculate time taken
      const timeElapsed = quest.completedAt && quest.acceptedAt
        ? quest.completedAt.getTime() - quest.acceptedAt.getTime()
        : 0;
      const hoursElapsed = Math.floor(timeElapsed / (1000 * 60 * 60));

      // Build embed
      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🎉 QUEST COMPLETED!')
        .setDescription(
          `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n` +
            `┃  **${faction.name}**\n` +
            `┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
            `**Quest:** ${quest.name}`
        )
        .addFields({
          name: '📊 Final Stats',
          value:
            `✅ Goal Achieved: ${formatQuestProgress(
              quest.type,
              quest.currentProgress
            )} / ${formatQuestGoal(quest.type, quest.goal)} (${progressPercent}%)\n` +
            `👥 Contributors: ${contributorCount} member${contributorCount !== 1 ? 's' : ''}\n` +
            `⏱️ Completed in: ${hoursElapsed} hours`,
        });

      // Treasury reward
      embed.addFields({
        name: '💰 Faction Treasury',
        value: `+${quest.treasuryReward.toLocaleString()} coins`,
        inline: false,
      });

      // Top contributors
      if (top3.length > 0) {
        let top3Text = '';
        for (const calc of top3) {
          const rankEmoji = getRankEmoji(calc.rank);
          const contributionText = formatQuestProgress(quest.type, calc.contribution);
          top3Text += `${rankEmoji} <@${calc.userId}> (${contributionText}) - ${calc.reward} coins\n`;
        }

        embed.addFields({
          name: '🏆 Top Contributors',
          value: top3Text,
        });
      }

      // Participation rewards
      const participantCount = rewardCalcs.length - 3;
      if (participantCount > 0) {
        embed.addFields({
          name: '👥 Participants',
          value: `${participantCount} member${
            participantCount !== 1 ? 's' : ''
          } - ${quest.participationReward} coins each`,
        });
      }

      // Bonus effect
      if (quest.bonusEffect) {
        const bonusText =
          quest.bonusEffect === 'coin_multiplier_2x_24h'
            ? '✨ **Bonus Unlocked:** 2x coin rate for 24 hours!'
            : quest.bonusEffect === 'upkeep_forgiven_today'
            ? '💰 **Bonus Unlocked:** Upkeep forgiven for today!'
            : `✨ **Bonus:** ${quest.bonusEffect}`;

        embed.addFields({
          name: '\u200B',
          value: bonusText,
        });
      }

      embed.setFooter({ text: `Amazing work, ${faction.name}! 🎊` });
      embed.setTimestamp();

      await channel.send({ embeds: [embed] });

      logger.info(`Sent quest completion announcement for quest ${quest.id}`);
    } catch (error) {
      logger.error(`Error sending quest completion announcement for quest ${quest.id}:`, error);
    }
  }
}

export const questRewardService = new QuestRewardService();
