import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import logger from '../core/logger';
import { roleUnlockConditionManager } from '../modules/roles/services/roleUnlockConditionManager';
import { roleActionLogger } from '../modules/roles/services/roleActionLogger';
import { roleAbilityService } from '../modules/roles/services/roleAbilityService';
import { formatRoleName, getRoleEmoji } from '../modules/roles/utils/formatters';
import { RoleType } from '../types/database';

export default {
  data: new SlashCommandBuilder()
    .setName('role-admin')
    .setDescription('Admin commands for role system')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-condition')
        .setDescription('Set unlock condition for a role')
        .addStringOption(option =>
          option
            .setName('role')
            .setDescription('Role type')
            .setRequired(true)
            .addChoices(
              { name: 'Guard', value: 'guard' },
              { name: 'Thief', value: 'thief' },
              { name: 'Witch', value: 'witch' },
              { name: 'Oracle', value: 'oracle' },
              { name: 'Enchanter', value: 'enchanter' },
              { name: 'Merchant', value: 'merchant' }
            )
        )
        .addStringOption(option =>
          option
            .setName('condition-type')
            .setDescription('Type of condition')
            .setRequired(true)
            .addChoices(
              { name: 'Faction Deposit', value: 'faction_deposit' },
              { name: 'Coins Spent', value: 'coins_spent' },
              { name: 'Quest', value: 'quest' }
            )
        )
        .addStringOption(option =>
          option
            .setName('value')
            .setDescription('Value (amount for deposit/spent, questId for quest)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list-conditions')
        .setDescription('View all role unlock conditions')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('action-history')
        .setDescription('View role action history')
        .addStringOption(option =>
          option
            .setName('type')
            .setDescription('Target type')
            .setRequired(true)
            .addChoices(
              { name: 'User', value: 'user' },
              { name: 'Faction', value: 'faction' }
            )
        )
        .addStringOption(option =>
          option
            .setName('target')
            .setDescription('User ID or Faction ID')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName('limit')
            .setDescription('Number of entries to show')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(100)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear-cooldown')
        .setDescription('Clear ability cooldown for a user')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('User to clear cooldown for')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('ability')
            .setDescription('Ability name')
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      // Verify admin permissions
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: '❌ You need Administrator permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const subcommand = interaction.options.getSubcommand();
      const guildId = interaction.guildId!;

      switch (subcommand) {
        case 'set-condition':
          await handleSetCondition(interaction, guildId);
          break;
        case 'list-conditions':
          await handleListConditions(interaction, guildId);
          break;
        case 'action-history':
          await handleActionHistory(interaction, guildId);
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
      logger.error('Error in role-admin command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while processing your request.',
      });
    }
  },
};

async function handleSetCondition(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const roleType = interaction.options.getString('role', true) as RoleType;
  const conditionType = interaction.options.getString('condition-type', true) as 'faction_deposit' | 'coins_spent' | 'quest';
  const valueInput = interaction.options.getString('value', true);

  // Parse value
  let value: number | string;
  if (conditionType === 'quest') {
    value = valueInput;
  } else {
    const numValue = parseInt(valueInput, 10);
    if (isNaN(numValue) || numValue <= 0) {
      await interaction.editReply({
        content: '❌ Invalid value. Must be a positive number for deposit/spent conditions.',
      });
      return;
    }
    value = numValue;
  }

  // Get existing conditions
  const existingConditions = await roleUnlockConditionManager.getConditions(guildId, roleType) || [];
  
  // Add or update condition
  const newConditions = [...existingConditions];
  const existingIndex = newConditions.findIndex(c => c.type === conditionType);
  
  if (existingIndex >= 0) {
    newConditions[existingIndex].value = value;
  } else {
    newConditions.push({ type: conditionType, value });
  }

  const success = await roleUnlockConditionManager.setConditions(guildId, roleType, newConditions);

  if (!success) {
    await interaction.editReply({
      content: '❌ Failed to set condition.',
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji(roleType)} ${formatRoleName(roleType)} Condition Set`)
    .setDescription(`**Type:** ${conditionType}\n**Value:** ${value}`)
    .setColor(0x5865f2)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleListConditions(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const allConditions = await roleUnlockConditionManager.getAllConditions(guildId);

  if (allConditions.length === 0) {
    await interaction.editReply({
      content: '❌ No role conditions configured.',
    });
    return;
  }

  const embeds = allConditions.map(condition => {
    const conditionsList = condition.conditions.map(c => 
      `**${c.type}:** ${c.value}`
    ).join('\n');

    return new EmbedBuilder()
      .setTitle(`${getRoleEmoji(condition.roleType)} ${formatRoleName(condition.roleType)}`)
      .setDescription(conditionsList || 'No conditions')
      .setColor(0x5865f2)
      .setTimestamp();
  });

  await interaction.editReply({ embeds });
}

async function handleActionHistory(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const type = interaction.options.getString('type', true);
  const target = interaction.options.getString('target', true);
  const limit = interaction.options.getInteger('limit') || 20;

  let logs;
  if (type === 'user') {
    logs = await roleActionLogger.getUserActionHistory(target, guildId, { limit });
  } else {
    logs = await roleActionLogger.getFactionActionHistory(target, guildId, { limit });
  }

  if (logs.length === 0) {
    await interaction.editReply({
      content: '❌ No action history found.',
    });
    return;
  }

  const logsList = logs.map(log => 
    `**${log.abilityName}** - ${log.success ? '✅' : '❌'} - ${new Date(log.createdAt).toLocaleString()}`
  ).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('Role Action History')
    .setDescription(logsList)
    .setColor(0x5865f2)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleClearCooldown(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const targetUser = interaction.options.getUser('user', true);
  const abilityName = interaction.options.getString('ability', true);

  // Clear cooldown by setting it to past date
  await roleAbilityService.setCooldown(targetUser.id, guildId, abilityName, -24); // Negative hours = past

  await interaction.editReply({
    content: `✅ Cleared cooldown for ${abilityName} for <@${targetUser.id}>.`,
  });
}

