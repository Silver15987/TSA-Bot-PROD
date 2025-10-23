import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { questManager } from '../modules/quests/services/questManager';
import { questAssignmentService } from '../modules/quests/services/questAssignmentService';
import { questCooldownManager } from '../modules/quests/services/questCooldownManager';
import { factionManager } from '../modules/factions/services/factionManager';
import { QuestTemplateData } from '../modules/quests/types';
import { formatQuestType, formatQuestGoal, formatBonusEffect } from '../modules/quests/utils/questFormatters';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('quest-admin')
    .setDescription('Admin commands for managing quests')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Create a new quest template')
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription('Quest type')
            .setRequired(true)
            .addChoices(
              { name: 'Collective VC Time', value: 'collective_vc_time' },
              { name: 'Treasury Deposit', value: 'treasury_deposit' },
              { name: 'Member Participation', value: 'member_participation' }
            )
        )
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Quest name (e.g., "Study Marathon")')
            .setRequired(true)
            .setMaxLength(100)
        )
        .addStringOption((option) =>
          option
            .setName('description')
            .setDescription('Quest description')
            .setRequired(true)
            .setMaxLength(500)
        )
        .addIntegerOption((option) =>
          option
            .setName('base_goal')
            .setDescription('Base goal (VC: hours, Coins: amount, Participation: percentage)')
            .setRequired(true)
            .setMinValue(1)
        )
        .addIntegerOption((option) =>
          option
            .setName('duration_hours')
            .setDescription('Duration in hours (after acceptance)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(168)
        )
        .addIntegerOption((option) =>
          option
            .setName('treasury_reward')
            .setDescription('Treasury reward in coins')
            .setRequired(true)
            .setMinValue(0)
        )
        .addIntegerOption((option) =>
          option
            .setName('top1_reward')
            .setDescription('1st place contributor reward')
            .setRequired(true)
            .setMinValue(0)
        )
        .addIntegerOption((option) =>
          option
            .setName('top2_reward')
            .setDescription('2nd place contributor reward')
            .setRequired(true)
            .setMinValue(0)
        )
        .addIntegerOption((option) =>
          option
            .setName('top3_reward')
            .setDescription('3rd place contributor reward')
            .setRequired(true)
            .setMinValue(0)
        )
        .addIntegerOption((option) =>
          option
            .setName('participation_reward')
            .setDescription('Participation reward for other contributors')
            .setRequired(true)
            .setMinValue(0)
        )
        .addStringOption((option) =>
          option
            .setName('bonus_effect')
            .setDescription('Bonus effect (optional)')
            .setRequired(false)
            .addChoices(
              { name: 'None', value: 'none' },
              { name: '2x Coin Rate for 24 Hours', value: 'coin_multiplier_2x_24h' },
              { name: 'Upkeep Forgiven Today', value: 'upkeep_forgiven_today' }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list-templates')
        .setDescription('View all quest templates')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('delete-template')
        .setDescription('Delete a quest template')
        .addStringOption((option) =>
          option
            .setName('template_id')
            .setDescription('ID of the quest template to delete')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('assign')
        .setDescription('Manually assign a quest to a faction')
        .addStringOption((option) =>
          option
            .setName('faction_name')
            .setDescription('Name of the faction')
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('template_id')
            .setDescription('ID of the quest template')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('cancel')
        .setDescription("Cancel a faction's current quest")
        .addStringOption((option) =>
          option
            .setName('faction_name')
            .setDescription('Name of the faction')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('view-active').setDescription('View all active quests in the server')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('clear-cooldown')
        .setDescription('Clear quest cooldown for a faction')
        .addStringOption((option) =>
          option
            .setName('faction_name')
            .setDescription('Name of the faction')
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    try {
      switch (subcommand) {
        case 'create':
          await handleCreate(interaction, guildId, userId);
          break;

        case 'list-templates':
          await handleListTemplates(interaction, guildId);
          break;

        case 'delete-template':
          await handleDeleteTemplate(interaction, guildId);
          break;

        case 'assign':
          await handleAssign(interaction, guildId);
          break;

        case 'cancel':
          await handleCancel(interaction, guildId);
          break;

        case 'view-active':
          await handleViewActive(interaction, guildId);
          break;

        case 'clear-cooldown':
          await handleClearCooldown(interaction, guildId);
          break;

        default:
          await interaction.editReply({
            content: '❌ Unknown subcommand',
          });
      }
    } catch (error) {
      logger.error('Error executing quest-admin command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while executing this command',
      });
    }
  },
};

/**
 * Handle quest template creation
 */
async function handleCreate(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  userId: string
) {
  const type = interaction.options.getString('type', true) as QuestTemplateData['type'];
  const name = interaction.options.getString('name', true);
  const description = interaction.options.getString('description', true);
  const baseGoalInput = interaction.options.getInteger('base_goal', true);
  const durationHours = interaction.options.getInteger('duration_hours', true);
  const treasuryReward = interaction.options.getInteger('treasury_reward', true);
  const top1Reward = interaction.options.getInteger('top1_reward', true);
  const top2Reward = interaction.options.getInteger('top2_reward', true);
  const top3Reward = interaction.options.getInteger('top3_reward', true);
  const participationReward = interaction.options.getInteger('participation_reward', true);
  const bonusEffect = interaction.options.getString('bonus_effect') || null;

  // Convert base goal based on type
  let baseGoal = baseGoalInput;
  if (type === 'collective_vc_time') {
    // Convert hours to milliseconds
    baseGoal = baseGoalInput * 60 * 60 * 1000;
  }

  const questData: QuestTemplateData = {
    type,
    name,
    description,
    baseGoal,
    durationHours,
    treasuryReward,
    firstPlaceReward: top1Reward,
    secondPlaceReward: top2Reward,
    thirdPlaceReward: top3Reward,
    participationReward,
    bonusEffect: bonusEffect === 'none' ? null : bonusEffect,
  };

  // Create quest template
  const result = await questManager.createQuestTemplate(guildId, userId, questData);

  if (!result.success) {
    await interaction.editReply({
      content: `❌ Failed to create quest template: ${result.error}`,
    });
    return;
  }

  // Success embed
  const embed = new EmbedBuilder()
    .setColor('#00FF00')
    .setTitle('✅ Quest Template Created')
    .setDescription(`**${questData.name}** has been added to the quest pool!`)
    .addFields(
      {
        name: '📋 Type',
        value: formatQuestType(questData.type),
        inline: true,
      },
      {
        name: '🎯 Base Goal',
        value: formatQuestGoal(questData.type, questData.baseGoal),
        inline: true,
      },
      {
        name: '⏱️ Duration',
        value: `${questData.durationHours} hours`,
        inline: true,
      },
      {
        name: '💰 Rewards',
        value:
          `Treasury: ${questData.treasuryReward} coins\n` +
          `Top 3: ${questData.firstPlaceReward}/${questData.secondPlaceReward}/${questData.thirdPlaceReward}\n` +
          `Participation: ${questData.participationReward} coins`,
      },
      {
        name: '✨ Bonus',
        value: formatBonusEffect(questData.bonusEffect),
      },
      {
        name: '🆔 Template ID',
        value: `\`${result.questId}\``,
      }
    )
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
  });

  logger.info(`Quest template "${questData.name}" created by ${userId} in guild ${guildId}`);
}

/**
 * Handle list templates
 */
async function handleListTemplates(interaction: ChatInputCommandInteraction, guildId: string) {
  const templates = await questManager.getQuestTemplates(guildId);

  if (templates.length === 0) {
    await interaction.editReply({
      content: '📝 No quest templates found. Use `/quest-admin create` to create one!',
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor('#0099FF')
    .setTitle('📚 Quest Templates')
    .setDescription(`Found ${templates.length} quest template(s)`)
    .setTimestamp();

  for (const template of templates.slice(0, 10)) {
    embed.addFields({
      name: `${template.name}`,
      value:
        `**ID:** \`${template.id}\`\n` +
        `**Type:** ${formatQuestType(template.type)}\n` +
        `**Goal:** ${formatQuestGoal(template.type, template.baseGoal)}\n` +
        `**Duration:** ${template.durationHours}h | **Treasury:** ${template.treasuryReward} coins`,
    });
  }

  if (templates.length > 10) {
    embed.setFooter({ text: `Showing 10 of ${templates.length} templates` });
  }

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle delete template
 */
async function handleDeleteTemplate(interaction: ChatInputCommandInteraction, guildId: string) {
  const templateId = interaction.options.getString('template_id', true);

  const template = await questManager.getQuestById(templateId, guildId);

  if (!template || !template.isTemplate) {
    await interaction.editReply({
      content: '❌ Quest template not found',
    });
    return;
  }

  const success = await questManager.deleteQuestTemplate(templateId, guildId);

  if (success) {
    await interaction.editReply({
      content: `✅ Quest template **${template.name}** has been deleted`,
    });
  } else {
    await interaction.editReply({
      content: '❌ Failed to delete quest template',
    });
  }
}

/**
 * Handle assign quest to faction
 */
async function handleAssign(interaction: ChatInputCommandInteraction, guildId: string) {
  const factionName = interaction.options.getString('faction_name', true);
  const templateId = interaction.options.getString('template_id', true);

  const faction = await factionManager.getFactionByName(factionName, guildId);

  if (!faction) {
    await interaction.editReply({
      content: `❌ Faction "${factionName}" not found`,
    });
    return;
  }

  const result = await questAssignmentService.assignSpecificQuest(
    interaction.client,
    templateId,
    faction.id,
    guildId,
    true
  );

  if (result.success) {
    await interaction.editReply({
      content: `✅ ${result.message}`,
    });
  } else {
    await interaction.editReply({
      content: `❌ ${result.error}`,
    });
  }
}

/**
 * Handle cancel faction quest
 */
async function handleCancel(interaction: ChatInputCommandInteraction, guildId: string) {
  const factionName = interaction.options.getString('faction_name', true);

  const faction = await factionManager.getFactionByName(factionName, guildId);

  if (!faction) {
    await interaction.editReply({
      content: `❌ Faction "${factionName}" not found`,
    });
    return;
  }

  const quest = await questManager.getActiveQuest(faction.id, guildId);

  if (!quest) {
    await interaction.editReply({
      content: `❌ ${faction.name} has no active or offered quest`,
    });
    return;
  }

  await questManager.updateQuestStatus(quest.id, guildId, 'expired');

  await interaction.editReply({
    content: `✅ Cancelled quest **${quest.name}** for faction **${faction.name}**`,
  });
}

/**
 * Handle view active quests
 */
async function handleViewActive(interaction: ChatInputCommandInteraction, guildId: string) {
  const activeQuests = await questManager.getQuestsByStatus(guildId, 'active');
  const offeredQuests = await questManager.getQuestsByStatus(guildId, 'offered');

  const allQuests = [...activeQuests, ...offeredQuests];

  if (allQuests.length === 0) {
    await interaction.editReply({
      content: '📝 No active or offered quests found',
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('📊 Active Quests')
    .setDescription(`Found ${allQuests.length} active/offered quest(s)`)
    .setTimestamp();

  for (const quest of allQuests.slice(0, 10)) {
    const faction = await factionManager.getFactionById(quest.factionId!, guildId);
    const statusEmoji = quest.status === 'active' ? '🟢' : '📬';
    const progress = ((quest.currentProgress / quest.goal) * 100).toFixed(1);

    embed.addFields({
      name: `${statusEmoji} ${faction?.name || 'Unknown Faction'} - ${quest.name}`,
      value:
        `**Status:** ${quest.status}\n` +
        `**Progress:** ${progress}% | **Goal:** ${formatQuestGoal(quest.type, quest.goal)}\n` +
        `**Deadline:** ${quest.questDeadline?.toLocaleString() || 'Not accepted yet'}`,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle clear cooldown
 */
async function handleClearCooldown(interaction: ChatInputCommandInteraction, guildId: string) {
  const factionName = interaction.options.getString('faction_name', true);

  const faction = await factionManager.getFactionByName(factionName, guildId);

  if (!faction) {
    await interaction.editReply({
      content: `❌ Faction "${factionName}" not found`,
    });
    return;
  }

  const success = await questCooldownManager.clearCooldown(faction.id);

  if (success) {
    await interaction.editReply({
      content: `✅ Cleared quest cooldown for **${faction.name}**`,
    });
  } else {
    await interaction.editReply({
      content: `❌ ${faction.name} has no active cooldown`,
    });
  }
}
