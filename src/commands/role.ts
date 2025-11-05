import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { database } from '../database/client';
import logger from '../core/logger';
import { roleManager } from '../modules/roles/services/roleManager';
import { roleConditionTracker } from '../modules/roles/services/roleConditionTracker';
import { roleUnlockConditionManager } from '../modules/roles/services/roleUnlockConditionManager';
import { formatRoleName, formatRoleDescription, formatRoleProgress, getRoleEmoji } from '../modules/roles/utils/formatters';
import { getAllRoleTypes } from '../modules/roles/types/roleDefinitions';
import { RoleType } from '../types/database';

export default {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Manage your faction role')
    .addSubcommand(subcommand =>
      subcommand
        .setName('progress')
        .setDescription('View progress toward role(s)')
        .addStringOption(option =>
          option
            .setName('role')
            .setDescription('Specific role to check (optional)')
            .setRequired(false)
            .addChoices(
              { name: 'Guard', value: 'guard' },
              { name: 'Thief', value: 'thief' },
              { name: 'Witch', value: 'witch' },
              { name: 'Oracle', value: 'oracle' },
              { name: 'Enchanter', value: 'enchanter' },
              { name: 'Merchant', value: 'merchant' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('View your current role and abilities')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('relinquish')
        .setDescription('Give up your current role')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('abilities')
        .setDescription('List abilities for your current role')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('purchase')
        .setDescription('Purchase a role directly with coins')
        .addStringOption(option =>
          option
            .setName('role')
            .setDescription('Role to purchase')
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
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const subcommand = interaction.options.getSubcommand();
      const userId = interaction.user.id;
      const guildId = interaction.guildId!;

      switch (subcommand) {
        case 'progress':
          await handleProgress(interaction, userId, guildId);
          break;
        case 'info':
          await handleInfo(interaction, userId, guildId);
          break;
        case 'relinquish':
          await handleRelinquish(interaction, userId, guildId);
          break;
        case 'abilities':
          await handleAbilities(interaction, userId, guildId);
          break;
        case 'purchase':
          await handlePurchase(interaction, userId, guildId);
          break;
        default:
          await interaction.editReply({
            content: '❌ Unknown subcommand',
          });
      }
    } catch (error) {
      logger.error('Error in role command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while processing your request.',
      });
    }
  },
};

async function handleProgress(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const roleOption = interaction.options.getString('role');

  if (roleOption) {
    // Show progress for specific role
    const roleType = roleOption as RoleType;
    const progress = await roleConditionTracker.getProgress(userId, guildId, roleType);
    const conditions = await roleUnlockConditionManager.getConditions(guildId, roleType);

    const embed = new EmbedBuilder()
      .setTitle(`${getRoleEmoji(roleType)} ${formatRoleName(roleType)} Progress`)
      .setDescription(formatRoleProgress(progress, conditions ? { conditions } as any : null))
      .setColor(0x5865f2)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } else {
    // Show progress for all roles
    const allProgress = await roleConditionTracker.getAllProgress(userId, guildId);
    const roleTypes = getAllRoleTypes();

    const embeds: EmbedBuilder[] = [];

    for (const roleType of roleTypes) {
      const progress = allProgress.find(p => p.roleType === roleType);
      const conditions = await roleUnlockConditionManager.getConditions(guildId, roleType);

      if (conditions && conditions.length > 0) {
        const embed = new EmbedBuilder()
          .setTitle(`${getRoleEmoji(roleType)} ${formatRoleName(roleType)}`)
          .setDescription(formatRoleProgress(progress || null, { conditions } as any))
          .setColor(0x5865f2);

        embeds.push(embed);
      }
    }

    if (embeds.length === 0) {
      await interaction.editReply({
        content: '❌ No role unlock conditions have been configured yet.',
      });
      return;
    }

    await interaction.editReply({ embeds });
  }
}

async function handleInfo(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const role = await roleManager.getUserRole(userId, guildId);

  if (!role) {
    await interaction.editReply({
      content: '❌ You do not have a role. Complete unlock conditions to get a role!',
    });
    return;
  }

  const roleDef = roleManager.getRoleDefinition(role);
  const user = await database.users.findOne({ id: userId, guildId });

  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji(role)} ${formatRoleName(role)}`)
    .setDescription(formatRoleDescription(role))
    .addFields(
      {
        name: 'Base Success Rate',
        value: `${roleDef.baseSuccessRate}%`,
        inline: true,
      },
      {
        name: 'Abilities',
        value: roleDef.abilities.length.toString(),
        inline: true,
      },
      {
        name: 'Faction',
        value: user?.currentFaction ? '✅ Member' : '❌ Not in faction',
        inline: true,
      }
    )
    .setColor(0x5865f2)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleRelinquish(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const result = await roleManager.relinquishRole(userId, guildId);

  if (!result.success) {
    await interaction.editReply({
      content: `❌ ${result.error || 'Failed to relinquish role'}`,
    });
    return;
  }

  await interaction.editReply({
    content: '✅ You have relinquished your role. You can now unlock a new role by completing conditions.',
  });
}

async function handleAbilities(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const role = await roleManager.getUserRole(userId, guildId);

  if (!role) {
    await interaction.editReply({
      content: '❌ You do not have a role.',
    });
    return;
  }

  const roleDef = roleManager.getRoleDefinition(role);
  const user = await database.users.findOne({ id: userId, guildId });
  const cooldowns = user?.roleCooldowns || [];

  const abilityFields = roleDef.abilities.map(ability => {
    const cooldown = cooldowns.find(c => c.abilityName === ability.name);
    const cooldownText = cooldown && new Date() < cooldown.cooldownEndsAt
      ? ` (Cooldown: ${formatCooldownRemaining(cooldown.cooldownEndsAt)})`
      : '';

    return {
      name: ability.name.charAt(0).toUpperCase() + ability.name.slice(1),
      value: `${ability.description}\n**Cost:** ${ability.cost} coins | **Cooldown:** ${ability.cooldownHours}h${cooldownText}`,
      inline: false,
    };
  });

  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji(role)} ${formatRoleName(role)} Abilities`)
    .addFields(abilityFields)
    .setColor(0x5865f2)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handlePurchase(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const roleOption = interaction.options.getString('role', true);
  const roleType = roleOption as RoleType;

  // Get user data
  const user = await database.users.findOne({ id: userId, guildId });
  if (!user) {
    await interaction.editReply({
      content: '❌ You are not registered. Use `/register` first.',
    });
    return;
  }

  // Check if user already has a role
  if (user.role) {
    await interaction.editReply({
      content: `❌ You already have the **${formatRoleName(user.role)}** role. Use \`/role relinquish\` to give it up first.`,
    });
    return;
  }

  // Get purchase conditions for this role
  const conditions = await roleUnlockConditionManager.getConditions(guildId, roleType);
  
  // Find coins_spent condition (for purchase price)
  const coinsSpentCondition = conditions?.find(c => c.type === 'coins_spent');
  
  if (!coinsSpentCondition) {
    await interaction.editReply({
      content: `❌ The **${formatRoleName(roleType)}** role cannot be purchased. No purchase price has been set.`,
    });
    return;
  }

  const price = coinsSpentCondition.value as number;

  // Check if user has enough coins
  if (user.coins < price) {
    await interaction.editReply({
      content: `❌ Insufficient coins! The **${formatRoleName(roleType)}** role costs **${price.toLocaleString()}** coins, but you only have **${user.coins.toLocaleString()}** coins.`,
    });
    return;
  }

  // Check if there are other conditions that must be met (besides coins_spent)
  const otherConditions = conditions?.filter(c => c.type !== 'coins_spent') || [];
  
  if (otherConditions.length > 0) {
    // There are other conditions besides coins_spent - check if they're met
    // Get user's progress to check other conditions
    const progress = await roleConditionTracker.getProgress(userId, guildId, roleType);
    
    if (!progress) {
      // No progress tracked yet - other conditions definitely not met
      const embed = new EmbedBuilder()
        .setTitle('❌ Additional Conditions Required')
        .setDescription(
          `The **${formatRoleName(roleType)}** role requires additional conditions:\n\n` +
          formatRoleProgress(null, { conditions } as any) +
          `\n\nComplete these conditions first, then you can purchase the role.`
        )
        .setColor(0xe74c3c);
      
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Check each other condition
    let allOtherConditionsMet = true;
    for (const condition of otherConditions) {
      if (condition.type === 'faction_deposit') {
        const required = condition.value as number;
        const current = progress.conditions.factionDeposit || 0;
        if (current < required) {
          allOtherConditionsMet = false;
          break;
        }
      } else if (condition.type === 'quest') {
        const requiredQuestId = condition.value as string;
        const completedQuests = progress.conditions.questsCompleted || [];
        if (!completedQuests.includes(requiredQuestId)) {
          allOtherConditionsMet = false;
          break;
        }
      }
    }

    if (!allOtherConditionsMet) {
      // Other conditions not met - show what's needed
      const embed = new EmbedBuilder()
        .setTitle('❌ Additional Conditions Required')
        .setDescription(
          `The **${formatRoleName(roleType)}** role requires additional conditions:\n\n` +
          formatRoleProgress(progress, { conditions } as any) +
          `\n\nComplete these conditions first, then you can purchase the role.`
        )
        .setColor(0xe74c3c);
      
      await interaction.editReply({ embeds: [embed] });
      return;
    }
  }

  // Deduct coins
  const newBalance = user.coins - price;
  await database.users.updateOne(
    { id: userId, guildId },
    {
      $inc: { coins: -price },
      $set: { updatedAt: new Date() },
    }
  );

  // Assign the role
  const result = await roleManager.setUserRole(userId, guildId, roleType);

  if (!result.success) {
    // Refund coins if role assignment failed
    await database.users.updateOne(
      { id: userId, guildId },
      {
        $inc: { coins: price },
        $set: { updatedAt: new Date() },
      }
    );

    await interaction.editReply({
      content: `❌ Failed to assign role: ${result.error || 'Unknown error'}`,
    });
    return;
  }

  // Log transaction
  await database.transactions.insertOne({
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
    userId,
    type: 'role_purchase',
    amount: -price,
    balanceAfter: newBalance,
    metadata: {
      roleType,
      guildId,
    },
    createdAt: new Date(),
  });

  // Track coins spent for role conditions
  await roleConditionTracker.updateProgress(userId, guildId, 'coins_spent', price);

  const embed = new EmbedBuilder()
    .setTitle(`✅ Role Purchased: ${getRoleEmoji(roleType)} ${formatRoleName(roleType)}`)
    .setDescription(
      `You have successfully purchased the **${formatRoleName(roleType)}** role!\n\n` +
      `**Cost:** ${price.toLocaleString()} coins\n` +
      `**New Balance:** ${newBalance.toLocaleString()} coins\n\n` +
      `Use \`/role info\` to view your role details and \`/role abilities\` to see your abilities.`
    )
    .setColor(0x2ecc71)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

function formatCooldownRemaining(cooldownEndsAt: Date): string {
  const now = new Date();
  const diff = cooldownEndsAt.getTime() - now.getTime();

  if (diff <= 0) {
    return 'Ready';
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

