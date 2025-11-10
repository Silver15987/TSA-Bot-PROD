import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Client,
} from 'discord.js';
import { database } from '../../../database/client';
import logger from '../../../core/logger';
import { roleManager } from '../services/roleManager';
import { roleAbilityService } from '../services/roleAbilityService';
import { roleActionLogger } from '../services/roleActionLogger';
import { getRoleEmoji } from '../utils/formatters';
import { RoleType } from '../../../types/database';

export default {
  data: new SlashCommandBuilder()
    .setName('oracle')
    .setDescription('Oracle role abilities')
    .addSubcommand(subcommand =>
      subcommand
        .setName('detect')
        .setDescription('Detect the identity of a Thief or Witch')
        .addUserOption(option =>
          option.setName('target').setDescription('Target user').setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('guess')
            .setDescription('Early guess (optional, costs extra coins)')
            .setRequired(false)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.user.id;
      const guildId = interaction.guildId!;

      // Verify user has Oracle role
      const role = await roleManager.getUserRole(userId, guildId);
      if (role !== 'oracle') {
        await interaction.editReply({
          content: '❌ You must be an Oracle to use this command.',
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'detect') {
        await handleDetect(interaction, userId, guildId);
      }
    } catch (error) {
      logger.error('Error in oracle command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while processing your request.',
      });
    }
  },
};

async function handleDetect(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guildId: string
): Promise<void> {
  const targetUser = interaction.options.getUser('target', true);
  const targetUserId = targetUser.id;
  const earlyGuess = interaction.options.getString('guess');

  // Get Oracle user data
  const oracle = await database.users.findOne({ id: userId, guildId });
  if (!oracle) {
    await interaction.editReply({
      content: '❌ User not found.',
    });
    return;
  }

  // Get target user data
  const target = await database.users.findOne({ id: targetUserId, guildId });
  if (!target) {
    await interaction.editReply({
      content: '❌ Target user not found.',
    });
    return;
  }

  // Check if target is actually a Thief or Witch
  if (target.role !== 'thief' && target.role !== 'witch') {
    await interaction.editReply({
      content: '❌ Target is not a Thief or Witch.',
    });
    return;
  }

  // Get detection history for this target
  const detectionLogs = await roleActionLogger.getUserActionHistory(
    userId,
    guildId,
    { limit: 100 }
  );
  
  const targetDetections = detectionLogs.filter(
    log => log.abilityName === 'detect' && log.targetUserId === targetUserId
  );

  const clueCount = targetDetections.length;
  const isFourthAttempt = clueCount >= 3;

  // Check cooldown (6 hours, but only if not 4th attempt)
  if (!isFourthAttempt) {
    const canUse = await roleAbilityService.canUseAbility(userId, guildId, 'detect');
    if (!canUse.canUse) {
      await interaction.editReply({
        content: `❌ ${canUse.error || 'Cannot use ability'}`,
      });
      return;
    }
  }

  // Calculate cost (250 per clue, free on 4th attempt)
  const cost = isFourthAttempt ? 0 : 250;

  // Check if Oracle has enough coins (unless 4th attempt)
  if (!isFourthAttempt && oracle.coins < cost) {
    await interaction.editReply({
      content: `❌ Insufficient coins! You need ${cost} coins but only have ${oracle.coins.toLocaleString()} coins.`,
    });
    return;
  }

  // Handle early guess
  if (earlyGuess) {
    const guessCost = 500; // Cost for early guess
    if (oracle.coins < guessCost) {
      await interaction.editReply({
        content: `❌ Insufficient coins for early guess! You need ${guessCost} coins but only have ${oracle.coins.toLocaleString()} coins.`,
      });
      return;
    }

    // Check if guess matches target's role
    const guessRole = earlyGuess.toLowerCase();
    const isCorrect = (guessRole === 'thief' && target.role === 'thief') ||
                      (guessRole === 'witch' && target.role === 'witch');

    if (isCorrect) {
      // Correct guess - reveal identity
      await roleAbilityService.deductCost(userId, guildId, guessCost);
      
      await roleAbilityService.logAbilityUse(
        userId,
        guildId,
        'oracle',
        'detect',
        true,
        targetUserId,
        undefined,
        undefined,
        { earlyGuess: true, correct: true, guessCost }
      );

      const embed = new EmbedBuilder()
        .setTitle(`${getRoleEmoji('oracle')} Detection Successful!`)
        .setDescription(
          `🎯 **Correct Guess!**\n\n` +
          `<@${targetUserId}> is a **${target.role === 'thief' ? 'Thief' : 'Witch'}**!\n\n` +
          `You spent ${guessCost.toLocaleString()} coins on the early guess.`
        )
        .setColor(0x2ecc71)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    } else {
      // Wrong guess - just charge cost
      await roleAbilityService.deductCost(userId, guildId, guessCost);
      
      await roleAbilityService.logAbilityUse(
        userId,
        guildId,
        'oracle',
        'detect',
        false,
        targetUserId,
        undefined,
        undefined,
        { earlyGuess: true, correct: false, guessCost }
      );

      const embed = new EmbedBuilder()
        .setTitle(`${getRoleEmoji('oracle')} Incorrect Guess`)
        .setDescription(
          `❌ Your guess was incorrect.\n\n` +
          `You spent ${guessCost.toLocaleString()} coins. Continue gathering clues or try again.`
        )
        .setColor(0xe74c3c)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }
  }

  // Generate clue based on attempt number
  let clue: string;
  if (isFourthAttempt) {
    // 4th attempt - reveal identity
    clue = `**FULL REVELATION:** <@${targetUserId}> is a **${target.role === 'thief' ? 'Thief' : 'Witch'}**!`;
  } else {
    // Generate clue based on attempt number
    const clues = await generateClues(target, guildId, interaction.client.users);
    if (clueCount < clues.length) {
      clue = clues[clueCount];
    } else {
      clue = `**Clue ${clueCount + 1}:** Continue investigating...`;
    }
  }

  // Deduct cost (if not 4th attempt)
  if (!isFourthAttempt) {
    await roleAbilityService.deductCost(userId, guildId, cost);
    await roleAbilityService.setCooldown(userId, guildId, 'detect', 6);
  }

  // Log action
  await roleAbilityService.logAbilityUse(
    userId,
    guildId,
    'oracle',
    'detect',
    isFourthAttempt,
    targetUserId,
    undefined,
    undefined,
    { clueCount: clueCount + 1, clue }
  );

  // Log transaction
  if (cost > 0) {
    const newBalance = oracle.coins - cost;
    await database.transactions.insertOne({
      id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      userId,
      type: 'role_ability',
      amount: -cost,
      balanceAfter: newBalance,
      metadata: {
        roleType: 'oracle',
        abilityName: 'detect',
        guildId,
      },
      createdAt: new Date(),
    });
  }

  const attemptsRemaining = isFourthAttempt ? 0 : 3 - clueCount;
  const embed = new EmbedBuilder()
    .setTitle(`${getRoleEmoji('oracle')} Detection Clue ${clueCount + 1}`)
    .setDescription(clue)
    .addFields(
      {
        name: 'Attempts',
        value: `${clueCount + 1}/4`,
        inline: true,
      },
      {
        name: 'Cost',
        value: isFourthAttempt ? 'Free' : `${cost.toLocaleString()} coins`,
        inline: true,
      },
      {
        name: 'Remaining Clues',
        value: attemptsRemaining > 0 ? `${attemptsRemaining} more clues available` : 'Identity revealed!',
        inline: false,
      }
    )
    .setColor(0x3498db)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function generateClues(
  target: any, 
  guildId: string, 
  users: Client['users']
): Promise<string[]> {
  const clues: string[] = [];
  
  // Clue 1: Faction hint
  if (target.currentFaction) {
    const faction = await database.factions.findOne({ id: target.currentFaction, guildId });
    if (faction) {
      clues.push(`**Clue 1:** The ${target.role === 'thief' ? 'Thief' : 'Witch'} is from the **${faction.name}** faction.`);
    } else {
      clues.push(`**Clue 1:** The ${target.role === 'thief' ? 'Thief' : 'Witch'} is from a faction.`);
    }
  } else {
    clues.push(`**Clue 1:** The ${target.role === 'thief' ? 'Thief' : 'Witch'} is not currently in a faction.`);
  }

  // Clue 2: Role hint (random role from all roles)
  const allRoles: RoleType[] = ['guard', 'thief', 'witch', 'oracle', 'enchanter', 'merchant'];
  const randomRole = allRoles[Math.floor(Math.random() * allRoles.length)];
  clues.push(`**Clue 2:** The ${target.role === 'thief' ? 'Thief' : 'Witch'} has the **${randomRole}** role (or had it).`);

  // Clue 3: Name substring hint
  try {
    const discordUser = await users.fetch(target.id);
    const username = discordUser.username;
    const substringLength = Math.max(2, Math.floor(username.length / 3));
    const startIndex = Math.floor(Math.random() * Math.max(0, username.length - substringLength));
    const substring = username.substring(startIndex, startIndex + substringLength);
    clues.push(`**Clue 3:** The ${target.role === 'thief' ? 'Thief' : 'Witch'}'s name contains the substring **"${substring}"**.`);
  } catch (error) {
    // Fallback if user fetch fails
    clues.push(`**Clue 3:** The ${target.role === 'thief' ? 'Thief' : 'Witch'}'s name contains specific characters.`);
  }

  return clues;
}
