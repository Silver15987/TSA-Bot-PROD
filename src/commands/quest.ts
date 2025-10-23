import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { questManager } from '../modules/quests/services/questManager';
import { questValidators } from '../modules/quests/services/questValidators';
import { factionManager } from '../modules/factions/services/factionManager';
import {
  formatQuestType,
  formatQuestGoal,
  formatQuestProgress,
  formatBonusEffect,
  formatTimeRemaining,
  calculateProgressPercentage,
  createProgressBar,
  getRankEmoji,
  getQuestStatusEmoji,
} from '../modules/quests/utils/questFormatters';
import { getDifficultyEmoji, getDifficultyLabel } from '../modules/quests/utils/difficultyScaler';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('quest')
    .setDescription('View and manage faction quests')
    .addSubcommand((subcommand) =>
      subcommand.setName('view').setDescription('View your faction\'s current quest')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('accept').setDescription('Accept an offered quest (Wardens/Overseers only)')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('progress').setDescription('Check progress on your faction\'s active quest')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('history').setDescription('View your faction\'s quest history')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    try {
      // Get user's faction
      const userDoc = await factionManager.getUserFaction(userId, guildId);

      if (!userDoc) {
        await interaction.editReply({
          content: '❌ You are not in a faction. Join a faction to participate in quests!',
        });
        return;
      }

      const faction = await factionManager.getFactionById(userDoc.id, guildId);

      if (!faction) {
        await interaction.editReply({
          content: '❌ Your faction could not be found',
        });
        return;
      }

      switch (subcommand) {
        case 'view':
          await handleView(interaction, faction.id, guildId);
          break;

        case 'accept':
          await handleAccept(interaction, faction, userId, guildId);
          break;

        case 'progress':
          await handleProgress(interaction, faction.id, guildId, userId);
          break;

        case 'history':
          await handleHistory(interaction, faction.id, faction.name, guildId);
          break;

        default:
          await interaction.editReply({
            content: '❌ Unknown subcommand',
          });
      }
    } catch (error) {
      logger.error('Error executing quest command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while executing this command',
      });
    }
  },
};

/**
 * Handle view quest
 */
async function handleView(
  interaction: ChatInputCommandInteraction,
  factionId: string,
  guildId: string
) {
  const quest = await questManager.getActiveQuest(factionId, guildId);

  if (!quest) {
    await interaction.editReply({
      content: '📝 Your faction has no active or offered quests at the moment.',
    });
    return;
  }

  const difficultyEmoji = getDifficultyEmoji(quest.difficulty);
  const difficultyLabel = getDifficultyLabel(quest.difficulty);
  const typeLabel = formatQuestType(quest.type);
  const goalText = formatQuestGoal(quest.type, quest.goal);
  const bonusText = formatBonusEffect(quest.bonusEffect);
  const statusEmoji = getQuestStatusEmoji(quest.status);

  const embed = new EmbedBuilder()
    .setColor(quest.status === 'offered' ? '#FFD700' : '#00FF00')
    .setTitle(`${statusEmoji} ${quest.name}`)
    .setDescription(quest.description)
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
      }
    );

  if (quest.status === 'offered') {
    const timeRemaining = formatTimeRemaining(quest.acceptanceDeadline!);

    embed.addFields(
      {
        name: '⏰ Time to Accept',
        value: timeRemaining,
        inline: true,
      },
      {
        name: '⏱️ Duration (After Acceptance)',
        value: `${quest.durationHours} hours`,
        inline: true,
      },
      {
        name: '\u200B',
        value: '\u200B',
        inline: true,
      }
    );
  } else if (quest.status === 'active') {
    const timeRemaining = formatTimeRemaining(quest.questDeadline!);
    const progressPercent = calculateProgressPercentage(quest.currentProgress, quest.goal);
    const progressBar = createProgressBar(progressPercent);
    const currentProgress = formatQuestProgress(quest.type, quest.currentProgress);

    embed.addFields(
      {
        name: '⏰ Time Remaining',
        value: timeRemaining,
        inline: true,
      },
      {
        name: '📊 Progress',
        value: `${currentProgress} / ${goalText}`,
        inline: true,
      },
      {
        name: '\u200B',
        value: '\u200B',
        inline: true,
      },
      {
        name: '📈 Progress Bar',
        value: progressBar,
        inline: false,
      }
    );
  }

  embed.addFields({
    name: '💰 Rewards',
    value:
      `**Treasury:** ${quest.treasuryReward.toLocaleString()} coins\n` +
      `**🏆 Top 3 Contributors:**\n` +
      `  🥇 1st: ${quest.topContributorRewards.first} coins\n` +
      `  🥈 2nd: ${quest.topContributorRewards.second} coins\n` +
      `  🥉 3rd: ${quest.topContributorRewards.third} coins\n` +
      `**👥 Participation:** ${quest.participationReward} coins each\n` +
      `**✨ Bonus:** ${bonusText}`,
  });

  if (quest.status === 'offered') {
    embed.addFields({
      name: '📝 How to Accept',
      value: 'Use `/quest accept` to begin this quest!\n(Only Wardens and Overseers can accept)',
    });
  }

  embed.setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle accept quest
 */
async function handleAccept(
  interaction: ChatInputCommandInteraction,
  faction: any,
  userId: string,
  guildId: string
) {
  // Get offered quest
  const quest = await questManager.getActiveQuest(faction.id, guildId);

  if (!quest) {
    await interaction.editReply({
      content: '❌ Your faction has no quests to accept',
    });
    return;
  }

  // Validate quest status
  const questValidation = await questValidators.validateQuestAcceptance(
    quest,
    faction.id,
    guildId
  );

  if (!questValidation.valid) {
    await interaction.editReply({
      content: `❌ ${questValidation.error}`,
    });
    return;
  }

  // Check user permissions
  const permissionCheck = await questValidators.canAcceptQuest(userId, faction);

  if (!permissionCheck.valid) {
    await interaction.editReply({
      content: `❌ ${permissionCheck.error}`,
    });
    return;
  }

  // Accept the quest
  const now = new Date();
  const questDeadline = new Date(now.getTime() + quest.durationHours * 60 * 60 * 1000);

  await database.quests.updateOne(
    { id: quest.id, guildId },
    {
      $set: {
        status: 'active',
        acceptedAt: now,
        questDeadline,
        updatedAt: now,
      },
    }
  );

  // Success embed
  const embed = new EmbedBuilder()
    .setColor('#00FF00')
    .setTitle('✅ Quest Accepted!')
    .setDescription(
      `**${quest.name}** is now active for ${faction.name}!\n\n` +
        `You have **${quest.durationHours} hours** to complete this quest.`
    )
    .addFields(
      {
        name: '🎯 Goal',
        value: formatQuestGoal(quest.type, quest.goal),
        inline: true,
      },
      {
        name: '⏰ Deadline',
        value: `<t:${Math.floor(questDeadline.getTime() / 1000)}:R>`,
        inline: true,
      },
      {
        name: '\u200B',
        value: '\u200B',
        inline: true,
      }
    )
    .addFields({
      name: '📢 Next Steps',
      value:
        quest.type === 'collective_vc_time'
          ? '🎤 Get your faction members in VC and start studying!'
          : quest.type === 'treasury_deposit'
          ? '💰 Deposit coins to your faction treasury using `/faction deposit`'
          : '👥 Get all faction members to participate!',
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });

  logger.info(
    `Quest "${quest.name}" accepted by ${userId} for faction ${faction.name} (${faction.id})`
  );
}

/**
 * Handle progress check
 */
async function handleProgress(
  interaction: ChatInputCommandInteraction,
  factionId: string,
  guildId: string,
  userId: string
) {
  const quest = await questManager.getActiveQuest(factionId, guildId);

  if (!quest || quest.status !== 'active') {
    await interaction.editReply({
      content: '❌ Your faction has no active quest',
    });
    return;
  }

  const progressPercent = calculateProgressPercentage(quest.currentProgress, quest.goal);
  const progressBar = createProgressBar(progressPercent, 20);
  const currentProgress = formatQuestProgress(quest.type, quest.currentProgress);
  const goalText = formatQuestGoal(quest.type, quest.goal);
  const timeRemaining = formatTimeRemaining(quest.questDeadline!);

  // Get top contributors
  const contributors = Object.values(quest.contributorStats).sort(
    (a, b) => b.contribution - a.contribution
  );

  let contributorList = '';
  for (let i = 0; i < Math.min(5, contributors.length); i++) {
    const contributor = contributors[i];
    const rankEmoji = getRankEmoji(i + 1);
    const contributionText = formatQuestProgress(quest.type, contributor.contribution);
    contributorList += `${rankEmoji} <@${contributor.userId}> - ${contributionText}\n`;
  }

  if (contributors.length === 0) {
    contributorList = 'No contributions yet. Be the first!';
  }

  // Find user's contribution
  const userContribution = quest.contributorStats[userId];
  let userStats = 'You haven\'t contributed yet';
  if (userContribution) {
    const userRank = contributors.findIndex((c) => c.userId === userId) + 1;
    const userContribText = formatQuestProgress(quest.type, userContribution.contribution);
    userStats = `${userContribText} (#${userRank})`;
  }

  const embed = new EmbedBuilder()
    .setColor('#0099FF')
    .setTitle(`📊 Quest Progress: ${quest.name}`)
    .addFields(
      {
        name: '🎯 Goal',
        value: `${currentProgress} / ${goalText}`,
        inline: true,
      },
      {
        name: '📈 Progress',
        value: `${progressPercent}%`,
        inline: true,
      },
      {
        name: '⏰ Time Remaining',
        value: timeRemaining,
        inline: true,
      }
    )
    .addFields({
      name: '📊 Progress Bar',
      value: progressBar,
    })
    .addFields({
      name: '🏆 Top Contributors',
      value: contributorList,
    })
    .addFields({
      name: '👤 Your Contribution',
      value: userStats,
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle quest history
 */
async function handleHistory(
  interaction: ChatInputCommandInteraction,
  factionId: string,
  factionName: string,
  guildId: string
) {
  const history = await questManager.getFactionQuestHistory(factionId, guildId, 10);

  if (history.length === 0) {
    await interaction.editReply({
      content: '📝 Your faction has no completed quests yet',
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor('#0099FF')
    .setTitle(`📜 ${factionName} Quest History`)
    .setDescription(`Last ${history.length} completed quest(s)`)
    .setTimestamp();

  for (const quest of history) {
    const statusEmoji = getQuestStatusEmoji(quest.status);
    const result = quest.status === 'completed' ? '✅ Completed' : '❌ Failed/Expired';
    const progressPercent = calculateProgressPercentage(quest.currentProgress, quest.goal);
    const currentProgress = formatQuestProgress(quest.type, quest.currentProgress);
    const goalText = formatQuestGoal(quest.type, quest.goal);

    embed.addFields({
      name: `${statusEmoji} ${quest.name}`,
      value:
        `**Result:** ${result}\n` +
        `**Progress:** ${currentProgress} / ${goalText} (${progressPercent}%)\n` +
        `**Completed:** ${quest.completedAt?.toLocaleDateString() || 'Unknown'}`,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

// Import database for quest update
import { database } from '../database/client';
