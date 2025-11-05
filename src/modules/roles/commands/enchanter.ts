import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { database } from '../../../database/client';
import logger from '../../../core/logger';
import { roleManager } from '../services/roleManager';
import { roleAbilityService } from '../services/roleAbilityService';
import { roleStatusManager } from '../services/roleStatusManager';
import { getRoleEmoji } from '../utils/formatters';
import { factionManager } from '../../factions/services/factionManager';

export default {
  data: new SlashCommandBuilder()
    .setName('enchanter')
    .setDescription('Enchanter role abilities')
    .addSubcommand(subcommand =>
      subcommand
        .setName('bless')
        .setDescription('Apply blessing to user or faction')
        .addStringOption(option =>
          option
            .setName('target')
            .setDescription('User mention or faction name')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('charm')
        .setDescription('Give instant coin boost to a user')
        .addUserOption(option =>
          option.setName('target').setDescription('Target user').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('dispel')
        .setDescription('Remove curse from target')
        .addStringOption(option =>
          option
            .setName('target')
            .setDescription('User mention or faction name')
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.user.id;
      const guildId = interaction.guildId!;

      // Verify user has Enchanter role
      const role = await roleManager.getUserRole(userId, guildId);
      if (role !== 'enchanter') {
        await interaction.editReply({
          content: '❌ You must be an Enchanter to use this command.',
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      switch (subcommand) {
        case 'bless':
          await handleBless(interaction, userId, guildId);
          break;
        case 'charm':
          await handleCharm(interaction, userId, guildId);
          break;
        case 'dispel':
          await handleDispel(interaction, userId, guildId);
          break;
        default:
          await interaction.editReply({
            content: '❌ Unknown subcommand',
          });
      }
    } catch (error) {
      logger.error('Error in enchanter command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while processing your request.',
      });
    }
  },
};

async function handleBless(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const targetInput = interaction.options.getString('target', true);

  // Check if enchanter already has an active blessing
  const activeBlessings = await roleStatusManager.getActiveStatusesByUser(
    userId,
    guildId,
    'blessing'
  );

  if (activeBlessings.length > 0) {
    await interaction.editReply({
      content: '❌ You can only maintain one blessing at a time.',
    });
    return;
  }

  // Check ability cooldown and cost
  const canUse = await roleAbilityService.canUseAbility(userId, guildId, 'bless');
  if (!canUse.canUse) {
    await interaction.editReply({
      content: `❌ ${canUse.error || 'Cannot use ability'}`,
    });
    return;
  }

  // Parse target (user mention or faction name)
  const targetMatch = targetInput.match(/<@!?(\d+)>/);
  let targetUserId: string | undefined;
  let targetFactionId: string | undefined;

  if (targetMatch) {
    // User target
    targetUserId = targetMatch[1];
    const targetUser = await database.users.findOne({ id: targetUserId, guildId });
    if (!targetUser) {
      await interaction.editReply({
        content: '❌ Target user not found.',
      });
      return;
    }
  } else {
    // Faction target
    const faction = await factionManager.getFactionByName(targetInput, guildId);
    if (!faction) {
      await interaction.editReply({
        content: `❌ Faction "${targetInput}" not found.`,
      });
      return;
    }
    targetFactionId = faction.id;
  }

  // Apply blessing (12 hours duration, +20% for user, +5% for faction)
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  const coinGainBonus = targetUserId ? 20 : 5; // 20% for user, 5% for faction

  const statusId = await roleStatusManager.applyStatus({
    guildId,
    userId,
    targetUserId,
    targetFactionId,
    roleType: 'enchanter',
    effectType: 'blessing',
    expiresAt,
    metadata: {
      coinGainBonus,
      castAt: new Date(),
    },
  });

  if (!statusId) {
    await interaction.editReply({
      content: '❌ Failed to apply blessing.',
    });
    return;
  }

  // Set cooldown
  await roleAbilityService.setCooldown(userId, guildId, 'bless', 12);

  // Log action
  await roleAbilityService.logAbilityUse(
    userId,
    guildId,
    'enchanter',
    'bless',
    true,
    targetUserId,
    targetFactionId,
    coinGainBonus
  );

  const targetDisplay = targetUserId 
    ? `<@${targetUserId}>` 
    : `faction "${targetInput}"`;

  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji('enchanter')} Blessing Applied`)
    .setDescription(
      `You have blessed ${targetDisplay}!\n\n` +
      `**Effect:** +${coinGainBonus}% coin gain for 12 hours\n` +
      `**Duration:** 12 hours`
    )
    .setColor(0x2ecc71)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleCharm(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const targetUser = interaction.options.getUser('target', true);
  const targetUserId = targetUser.id;

  // Check ability cooldown
  const canUse = await roleAbilityService.canUseAbility(userId, guildId, 'charm');
  if (!canUse.canUse) {
    await interaction.editReply({
      content: `❌ ${canUse.error || 'Cannot use ability'}`,
    });
    return;
  }

  // Get enchanter data
  const enchanter = await database.users.findOne({ id: userId, guildId });
  if (!enchanter) {
    await interaction.editReply({
      content: '❌ User not found.',
    });
    return;
  }

  // Calculate charm amount based on enchanter's coins (e.g., 1% of enchanter's coins)
  const charmAmount = Math.floor(enchanter.coins * 0.01);
  const cost = Math.floor(charmAmount * 0.1); // 10% of charm amount as cost

  if (enchanter.coins < cost) {
    await interaction.editReply({
      content: `❌ Insufficient coins! You need ${cost.toLocaleString()} coins but only have ${enchanter.coins.toLocaleString()} coins.`,
    });
    return;
  }

  // Apply instant coin boost to target
  await database.users.updateOne(
    { id: targetUserId, guildId },
    { $inc: { coins: charmAmount }, $set: { updatedAt: new Date() } }
  );

  // Deduct cost from enchanter
  await roleAbilityService.deductCost(userId, guildId, cost);

  // Set cooldown
  await roleAbilityService.setCooldown(userId, guildId, 'charm', 12);

  // Log action
  await roleAbilityService.logAbilityUse(
    userId,
    guildId,
    'enchanter',
    'charm',
    true,
    targetUserId,
    undefined,
    charmAmount
  );

  // Log transaction
  const newBalance = enchanter.coins - cost;
  await database.transactions.insertOne({
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
    userId,
    type: 'role_ability',
    amount: -cost,
    balanceAfter: newBalance,
    metadata: {
      roleType: 'enchanter',
      abilityName: 'charm',
      guildId,
    },
    createdAt: new Date(),
  });

  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji('enchanter')} Coin Charm Applied`)
    .setDescription(
      `You have granted <@${targetUserId}> an instant coin boost!\n\n` +
      `**Boost Amount:** ${charmAmount.toLocaleString()} coins\n` +
      `**Cost:** ${cost.toLocaleString()} coins`
    )
    .setColor(0x2ecc71)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleDispel(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const targetInput = interaction.options.getString('target', true);

  // Check ability cooldown
  const canUse = await roleAbilityService.canUseAbility(userId, guildId, 'dispel');
  if (!canUse.canUse) {
    await interaction.editReply({
      content: `❌ ${canUse.error || 'Cannot use ability'}`,
    });
    return;
  }

  // Parse target (user mention or faction name)
  const targetMatch = targetInput.match(/<@!?(\d+)>/);
  let targetUserId: string | undefined;
  let targetFactionId: string | undefined;

  if (targetMatch) {
    // User target
    targetUserId = targetMatch[1];
    const targetUser = await database.users.findOne({ id: targetUserId, guildId });
    if (!targetUser) {
      await interaction.editReply({
        content: '❌ Target user not found.',
      });
      return;
    }
  } else {
    // Faction target
    const faction = await factionManager.getFactionByName(targetInput, guildId);
    if (!faction) {
      await interaction.editReply({
        content: `❌ Faction "${targetInput}" not found.`,
      });
      return;
    }
    targetFactionId = faction.id;
  }

  // Find active curses on target
  const activeCurses = targetUserId
    ? await roleStatusManager.getActiveStatusesForUser(targetUserId, guildId, 'curse')
    : await roleStatusManager.getActiveStatusesForFaction(targetFactionId!, guildId, 'curse');

  if (activeCurses.length === 0) {
    await interaction.editReply({
      content: '❌ No active curses found on this target.',
    });
    return;
  }

  // Remove the first curse (or allow selection - for now, just remove first)
  const curseToRemove = activeCurses[0];
  const removed = await roleStatusManager.removeStatus(curseToRemove.id);

  if (!removed) {
    await interaction.editReply({
      content: '❌ Failed to remove curse.',
    });
    return;
  }

  // Set cooldown
  await roleAbilityService.setCooldown(userId, guildId, 'dispel', 12);

  // Log action
  await roleAbilityService.logAbilityUse(
    userId,
    guildId,
    'enchanter',
    'dispel',
    true,
    targetUserId,
    targetFactionId
  );

  const targetDisplay = targetUserId 
    ? `<@${targetUserId}>` 
    : `faction "${targetInput}"`;

  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji('enchanter')} Curse Dispelled`)
    .setDescription(
      `You have successfully dispelled a curse from ${targetDisplay}!\n\n` +
      `The curse has been removed.`
    )
    .setColor(0x2ecc71)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
