import { SlashCommandBuilder, ChatInputCommandInteraction, Guild, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { database } from '../database/client';
import { configManager } from '../core/configManager';
import { factionManager } from '../modules/factions/services/factionManager';
import { discordResourceManager } from '../modules/factions/services/discordResourceManager';
import { treasuryManager } from '../modules/factions/services/treasuryManager';
import { memberManager } from '../modules/factions/services/memberManager';
import { disbandManager } from '../modules/factions/services/disbandManager';
import { factionAnnouncementService } from '../modules/factions/services/factionAnnouncementService';
import { factionLedgerService } from '../modules/factions/services/factionLedgerService';
import { factionValidator } from '../modules/factions/utils/validators';
import { factionFormatter } from '../modules/factions/utils/formatters';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('faction')
    .setDescription('Manage your faction')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new faction')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Name of your faction')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName('deposit')
            .setDescription('Initial treasury deposit (coins)')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('View faction information')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Faction name (default: your faction)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all factions in the server')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('deposit')
        .setDescription('Deposit coins into your faction treasury')
        .addIntegerOption(option =>
          option
            .setName('amount')
            .setDescription('Amount of coins to deposit')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('invite')
        .setDescription('Invite a user to your faction')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('User to invite')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('kick')
        .setDescription('Remove a member from your faction')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('Member to kick')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('leave')
        .setDescription('Leave your current faction')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('transfer')
        .setDescription('Transfer faction ownership to another member')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('New owner')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('promote')
        .setDescription('Promote an Acolyte to Warden (Overseer only)')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('Member to promote to Warden')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('demote')
        .setDescription('Demote a Warden to Acolyte (Overseer only)')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('Warden to demote to Acolyte')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('disband')
        .setDescription('Permanently disband your faction (Overseer only)')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('ledger')
        .setDescription('View faction transaction history (deposits/withdrawals)')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Faction name (default: your faction)')
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('page')
            .setDescription('Page number (default: 1)')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('View your faction\'s status and multiplier information')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'create':
          await handleCreate(interaction);
          break;
        case 'info':
          await handleInfo(interaction);
          break;
        case 'list':
          await handleList(interaction);
          break;
        case 'deposit':
          await handleDeposit(interaction);
          break;
        case 'invite':
          await handleInvite(interaction);
          break;
        case 'kick':
          await handleKick(interaction);
          break;
        case 'leave':
          await handleLeave(interaction);
          break;
        case 'transfer':
          await handleTransfer(interaction);
          break;
        case 'promote':
          await handlePromote(interaction);
          break;
        case 'demote':
          await handleDemote(interaction);
          break;
        case 'disband':
          await handleDisband(interaction);
          break;
        case 'ledger':
          await handleLedger(interaction);
          break;
        case 'status':
          await handleStatus(interaction);
          break;
        default:
          await interaction.editReply({
            content: '❌ Unknown subcommand',
          });
      }
    } catch (error) {
      logger.error('Error in faction command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while processing your request. Please try again.',
      });
    }
  },
};

/**
 * Handle /faction create
 */
async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString('name', true);
  const deposit = interaction.options.getInteger('deposit', true);
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const guild = interaction.guild as Guild;

  try {
    // Get config
    const config = configManager.getConfig(guildId);

    // Check if factions are enabled
    if (!config.factions.enabled) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Factions Disabled',
          'Factions are currently disabled on this server.'
        )],
      });
      return;
    }

    // Check if factionCategoryId is set
    if (!config.factions.factionCategoryId) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Configuration Error',
          'Faction category is not configured. Please contact a server administrator.'
        )],
      });
      return;
    }

    // Validate faction name
    const nameValidation = factionValidator.validateFactionName(name);
    if (!nameValidation.valid) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Invalid Faction Name',
          nameValidation.error!
        )],
      });
      return;
    }

    // Check if faction name already exists
    const nameExists = await factionManager.factionNameExists(name, guildId);
    if (nameExists) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Name Already Taken',
          `A faction with the name "${name}" already exists.`
        )],
      });
      return;
    }

    // Check faction limit
    const factionCount = await factionManager.getFactionCount(guildId);
    if (factionCount >= config.factions.maxFactionsPerServer) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Server Faction Limit Reached',
          `This server has reached the maximum of ${config.factions.maxFactionsPerServer} factions.`
        )],
      });
      return;
    }

    // Check if user is already in a faction
    const currentFaction = await factionManager.getUserFaction(userId, guildId);
    if (currentFaction) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Already in Faction',
          `You are already a member of **${currentFaction.name}**. Leave your current faction before creating a new one.`
        )],
      });
      return;
    }

    // Get user data
    const userData = await database.users.findOne({ id: userId, guildId });
    if (!userData) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Not Registered',
          'You need to register first! Use `/register` to get started.'
        )],
      });
      return;
    }

    // Check if user can afford creation cost + initial deposit
    const totalCost = config.factions.createCost + deposit;
    if (userData.coins < totalCost) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Insufficient Coins',
          `You need **${factionFormatter.formatCoins(totalCost)}** coins to create this faction.\n\n` +
          `**Breakdown:**\n` +
          `• Creation fee: ${factionFormatter.formatCoins(config.factions.createCost)} coins\n` +
          `• Initial deposit: ${factionFormatter.formatCoins(deposit)} coins\n\n` +
          `**Your balance:** ${factionFormatter.formatCoins(userData.coins)} coins`
        )],
      });
      return;
    }

    // Validate initial deposit meets minimum requirement
    if (deposit < config.factions.minInitialDeposit) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Deposit Too Low',
          `Initial deposit must be at least **${factionFormatter.formatCoins(config.factions.minInitialDeposit)}** coins.`
        )],
      });
      return;
    }

    // Create Discord resources (role + channel)
    const resources = await discordResourceManager.createFactionResources(guild, name);
    if (!resources) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Resource Creation Failed',
          'Failed to create Discord role or channel. Please try again or contact an administrator.'
        )],
      });
      return;
    }

    // Create faction in database
    const result = await factionManager.createFaction(
      guildId,
      name,
      userId,
      resources.roleId,
      resources.channelId,
      deposit
    );

    if (!result.success) {
      // Cleanup Discord resources if database creation failed
      await discordResourceManager.deleteFactionResources(guild, resources.roleId, resources.channelId);

      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Creation Failed',
          result.error || 'Failed to create faction in database. Please try again.'
        )],
      });
      return;
    }

    // Deduct coins from user (creation cost + initial deposit)
    await database.users.updateOne(
      { id: userId, guildId },
      {
        $inc: { coins: -totalCost },
        $set: {
          currentFaction: result.factionId,
          factionJoinDate: new Date(),
          factionCoinsDeposited: deposit,
          updatedAt: new Date(),
        },
      }
    );

    // Log transaction for creation cost
    await database.transactions.insertOne({
      id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      userId,
      type: 'faction_deposit',
      amount: -config.factions.createCost,
      balanceAfter: userData.coins - totalCost,
      metadata: {
        factionId: result.factionId,
        factionName: name,
        reason: 'faction_creation_fee',
        guildId,
      },
      createdAt: new Date(),
    });

    // Log transaction for initial deposit
    await database.transactions.insertOne({
      id: `tx_${Date.now() + 1}_${Math.random().toString(36).substring(2, 15)}`,
      userId,
      type: 'faction_deposit',
      amount: -deposit,
      balanceAfter: userData.coins - totalCost,
      metadata: {
        factionId: result.factionId,
        factionName: name,
        reason: 'initial_deposit',
        guildId,
      },
      createdAt: new Date(),
    });

    // Assign faction role to user
    try {
      const member = await guild.members.fetch(userId);
      await member.roles.add(resources.roleId);
    } catch (error) {
      logger.error(`Failed to assign faction role to user ${userId}:`, error);
    }

    // Success message
    await interaction.editReply({
      embeds: [factionFormatter.createSuccessEmbed(
        'Faction Created!',
        `**${name}** has been successfully created!\n\n` +
        `**Treasury:** ${factionFormatter.formatCoins(deposit)} coins\n` +
        `**Daily Upkeep:** ${factionFormatter.formatCoins(config.factions.dailyUpkeepCost)} coins\n` +
        `**Your New Balance:** ${factionFormatter.formatCoins(userData.coins - totalCost)} coins\n\n` +
        `Use \`/faction info\` to view your faction details.`
      )],
    });

    // Send faction creation announcement
    await factionAnnouncementService.sendFactionCreatedAnnouncement(
      interaction.client,
      guildId,
      name,
      interaction.user.username,
      resources.roleId
    );

    logger.info(`Faction "${name}" created by user ${userId} in guild ${guildId}`);
  } catch (error) {
    logger.error('Error in faction create:', error);
    throw error;
  }
}

/**
 * Handle /faction info
 */
async function handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  const factionName = interaction.options.getString('name');
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  try {
    let faction;

    if (factionName) {
      // Get faction by name
      faction = await factionManager.getFactionByName(factionName, guildId);
      if (!faction) {
        await interaction.editReply({
          embeds: [factionFormatter.createErrorEmbed(
            'Faction Not Found',
            `No faction with the name "${factionName}" exists.`
          )],
        });
        return;
      }
    } else {
      // Get user's current faction
      faction = await factionManager.getUserFaction(userId, guildId);
      if (!faction) {
        await interaction.editReply({
          embeds: [factionFormatter.createErrorEmbed(
            'Not in a Faction',
            'You are not currently in a faction. Use `/faction create` to start one or get invited to join one.'
          )],
        });
        return;
      }
    }

    // Get owner username
    let ownerUsername = 'Unknown';
    try {
      const owner = await interaction.client.users.fetch(faction.ownerId);
      ownerUsername = owner.username;
    } catch (error) {
      logger.error(`Failed to fetch owner user ${faction.ownerId}:`, error);
    }

    // Create and send embed
    const embed = factionFormatter.createFactionInfoEmbed(faction, ownerUsername);
    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error('Error in faction info:', error);
    throw error;
  }
}

/**
 * Handle /faction list
 */
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const guild = interaction.guild as Guild;

  try {
    // Get all factions
    const factions = await factionManager.getAllFactions(guildId);

    // Create and send embed
    const embed = factionFormatter.createFactionListEmbed(factions, guild.name);
    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error('Error in faction list:', error);
    throw error;
  }
}

/**
 * Handle /faction deposit
 */
async function handleDeposit(interaction: ChatInputCommandInteraction): Promise<void> {
  const amount = interaction.options.getInteger('amount', true);
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  try {
    // Get user's faction
    const faction = await factionManager.getUserFaction(userId, guildId);
    if (!faction) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Not in a Faction',
          'You must be in a faction to deposit coins. Use `/faction create` to start one or get invited to join one.'
        )],
      });
      return;
    }

    // Validate amount
    const amountValidation = factionValidator.validateTreasuryAmount(amount, 'deposit');
    if (!amountValidation.valid) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Invalid Amount',
          amountValidation.error!
        )],
      });
      return;
    }

    // Get user data for balance check
    const userData = await database.users.findOne({ id: userId, guildId });
    if (!userData) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'User Not Found',
          'Your user data could not be found. Please try again.'
        )],
      });
      return;
    }

    // Check balance
    if (userData.coins < amount) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Insufficient Balance',
          `You need **${factionFormatter.formatCoins(amount)}** coins to deposit, but you only have **${factionFormatter.formatCoins(userData.coins)}** coins.`
        )],
      });
      return;
    }

    // Perform deposit
    const result = await treasuryManager.depositToTreasury(faction.id, guildId, userId, amount);

    if (!result.success) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Deposit Failed',
          result.error || 'An error occurred while processing your deposit. Please try again.'
        )],
      });
      return;
    }

    // Success message
    const newUserBalance = userData.coins - amount;
    const totalDeposited = (userData.factionCoinsDeposited || 0) + amount;

    await interaction.editReply({
      embeds: [factionFormatter.createSuccessEmbed(
        'Deposit Successful!',
        `You deposited **${factionFormatter.formatCoins(amount)}** coins to **${faction.name}**'s treasury!\n\n` +
        `**New Treasury Balance:** ${factionFormatter.formatCoins(result.newBalance!)} coins\n` +
        `**Your Balance:** ${factionFormatter.formatCoins(newUserBalance)} coins\n` +
        `**Your Total Deposits:** ${factionFormatter.formatCoins(totalDeposited)} coins`
      )],
    });

    logger.info(`User ${userId} deposited ${amount} coins to faction ${faction.id}`);
  } catch (error) {
    logger.error('Error in faction deposit:', error);
    throw error;
  }
}

/**
 * Handle /faction invite
 */
async function handleInvite(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser('user', true);
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const guild = interaction.guild as Guild;

  try {
    // Check if inviting self
    if (targetUser.id === userId) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Invalid Target',
          'You cannot invite yourself!'
        )],
      });
      return;
    }

    // Check if target is a bot
    if (targetUser.bot) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Invalid Target',
          'Bots cannot join factions.'
        )],
      });
      return;
    }

    // Get inviter's faction
    const faction = await factionManager.getUserFaction(userId, guildId);
    if (!faction) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Not in a Faction',
          'You must be in a faction to invite members.'
        )],
      });
      return;
    }

    // Get config for max members
    const config = configManager.getConfig(guildId);

    // Check if user can invite
    const canInvite = await memberManager.canInviteUser(
      faction.id,
      guildId,
      userId,
      targetUser.id,
      config.factions.maxMembersPerFaction
    );

    if (!canInvite.success) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Invite Failed',
          canInvite.error!
        )],
      });
      return;
    }

    // Create buttons for accept/decline
    const acceptButton = new ButtonBuilder()
      .setCustomId('accept_invite')
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success);

    const declineButton = new ButtonBuilder()
      .setCustomId('decline_invite')
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(acceptButton, declineButton);

    // Send invite message (mention the target user)
    await interaction.editReply({
      content: `${targetUser}`,
      embeds: [factionFormatter.createSuccessEmbed(
        'Faction Invite!',
        `**${interaction.user.username}** has invited you to join **${faction.name}**!\n\n` +
        `Click Accept to join the faction or Decline to reject the invite.\n` +
        `This invite expires in 5 minutes.`
      )],
      components: [row],
    });

    // Create collector for button interactions
    const response = await interaction.fetchReply();
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 300000, // 5 minutes
    });

    collector.on('collect', async (buttonInteraction) => {
      // Only the invited user can respond
      if (buttonInteraction.user.id !== targetUser.id) {
        await buttonInteraction.reply({
          content: '❌ This invite is not for you!',
          ephemeral: true,
        });
        return;
      }

      if (buttonInteraction.customId === 'accept_invite') {
        // Defer the interaction immediately to prevent timeout
        await buttonInteraction.deferUpdate();

        // Accept invite
        const result = await memberManager.addMember(faction.id, guildId, targetUser.id, guild);

        if (result.success) {
          await buttonInteraction.editReply({
            content: `${targetUser}`,
            embeds: [factionFormatter.createSuccessEmbed(
              'Welcome to the Faction!',
              `**${targetUser.username}** has joined **${faction.name}**!`
            )],
            components: [],
          });

          logger.info(`User ${targetUser.id} accepted invite to faction ${faction.id}`);
        } else {
          await buttonInteraction.editReply({
            content: `${targetUser}`,
            embeds: [factionFormatter.createErrorEmbed(
              'Failed to Join',
              result.error || 'An error occurred while joining the faction.'
            )],
            components: [],
          });
        }

        collector.stop();
      } else if (buttonInteraction.customId === 'decline_invite') {
        // Decline invite
        await buttonInteraction.update({
          content: `${targetUser}`,
          embeds: [factionFormatter.createWarningEmbed(
            'Invite Declined',
            `**${targetUser.username}** declined the invite to **${faction.name}**.`
          )],
          components: [],
        });

        logger.info(`User ${targetUser.id} declined invite to faction ${faction.id}`);
        collector.stop();
      }
    });

    collector.on('end', async (_collected, reason) => {
      if (reason === 'time') {
        // Invite expired
        await interaction.editReply({
          content: `${targetUser}`,
          embeds: [factionFormatter.createWarningEmbed(
            'Invite Expired',
            'The faction invite has expired.'
          )],
          components: [],
        });
      }
    });
  } catch (error) {
    logger.error('Error in faction invite:', error);
    throw error;
  }
}

/**
 * Handle /faction kick
 */
async function handleKick(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser('user', true);
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const guild = interaction.guild as Guild;

  try {
    // Check if kicking self
    if (targetUser.id === userId) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Invalid Target',
          'Use `/faction leave` if you want to leave the faction.'
        )],
      });
      return;
    }

    // Get kicker's faction
    const faction = await factionManager.getUserFaction(userId, guildId);
    if (!faction) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Not in a Faction',
          'You must be in a faction to kick members.'
        )],
      });
      return;
    }

    // Kick member
    const result = await memberManager.kickMember(faction.id, guildId, userId, targetUser.id, guild);

    if (!result.success) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Kick Failed',
          result.error!
        )],
      });
      return;
    }

    // Success
    await interaction.editReply({
      embeds: [factionFormatter.createSuccessEmbed(
        'Member Kicked',
        `**${targetUser.username}** has been removed from **${faction.name}**.`
      )],
    });

    logger.info(`User ${targetUser.id} was kicked from faction ${faction.id} by ${userId}`);
  } catch (error) {
    logger.error('Error in faction kick:', error);
    throw error;
  }
}

/**
 * Handle /faction leave
 */
async function handleLeave(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const guild = interaction.guild as Guild;

  try {
    // Get user's faction
    const faction = await factionManager.getUserFaction(userId, guildId);
    if (!faction) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Not in a Faction',
          'You are not currently in a faction.'
        )],
      });
      return;
    }

    // Leave faction
    const result = await memberManager.leaveFaction(faction.id, guildId, userId, guild);

    if (!result.success) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Failed to Leave',
          result.error!
        )],
      });
      return;
    }

    // Success
    await interaction.editReply({
      embeds: [factionFormatter.createSuccessEmbed(
        'Left Faction',
        `You have left **${faction.name}**.\n\n` +
        `Note: Your deposited coins are not refunded when leaving a faction.`
      )],
    });

    logger.info(`User ${userId} left faction ${faction.id}`);
  } catch (error) {
    logger.error('Error in faction leave:', error);
    throw error;
  }
}

/**
 * Handle /faction transfer
 */
async function handleTransfer(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser('user', true);
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  try {
    // Check if transferring to self
    if (targetUser.id === userId) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Invalid Target',
          'You are already the owner of your faction.'
        )],
      });
      return;
    }

    // Check if target is a bot
    if (targetUser.bot) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Invalid Target',
          'Bots cannot be faction owners.'
        )],
      });
      return;
    }

    // Get owner's faction
    const faction = await factionManager.getUserFaction(userId, guildId);
    if (!faction) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Not in a Faction',
          'You must be in a faction to transfer ownership.'
        )],
      });
      return;
    }

    // Transfer ownership
    const result = await memberManager.transferOwnership(faction.id, guildId, userId, targetUser.id);

    if (!result.success) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Transfer Failed',
          result.error!
        )],
      });
      return;
    }

    // Success
    await interaction.editReply({
      embeds: [factionFormatter.createSuccessEmbed(
        'Ownership Transferred',
        `Faction **${faction.name}** is now owned by **${targetUser.username}**.\n\n` +
        `You have been added as an officer in the faction.`
      )],
    });

    logger.info(`Faction ${faction.id} ownership transferred from ${userId} to ${targetUser.id}`);
  } catch (error) {
    logger.error('Error in faction transfer:', error);
    throw error;
  }
}

/**
 * Handle /faction promote
 */
async function handlePromote(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser('user', true);
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  try {
    // Check if promoting self
    if (targetUser.id === userId) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Invalid Target',
          'You cannot promote yourself!'
        )],
      });
      return;
    }

    // Check if target is a bot
    if (targetUser.bot) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Invalid Target',
          'Bots cannot be promoted.'
        )],
      });
      return;
    }

    // Get user's faction
    const faction = await factionManager.getUserFaction(userId, guildId);
    if (!faction) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Not in a Faction',
          'You must be in a faction to promote members.'
        )],
      });
      return;
    }

    // Promote member
    const result = await memberManager.promoteMember(faction.id, guildId, userId, targetUser.id);

    if (!result.success) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Promotion Failed',
          result.error!
        )],
      });
      return;
    }

    // Success
    await interaction.editReply({
      embeds: [factionFormatter.createSuccessEmbed(
        'Member Promoted!',
        `**${targetUser.username}** has been promoted to **${factionFormatter.getRoleName('warden')}** in **${faction.name}**!\n\n` +
        `Wardens can invite and kick members.`
      )],
    });

    logger.info(`User ${targetUser.id} promoted to Warden in faction ${faction.id}`);
  } catch (error) {
    logger.error('Error in faction promote:', error);
    throw error;
  }
}

/**
 * Handle /faction demote
 */
async function handleDemote(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser('user', true);
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  try {
    // Check if demoting self
    if (targetUser.id === userId) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Invalid Target',
          'You cannot demote yourself!'
        )],
      });
      return;
    }

    // Check if target is a bot
    if (targetUser.bot) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Invalid Target',
          'Bots cannot be demoted.'
        )],
      });
      return;
    }

    // Get user's faction
    const faction = await factionManager.getUserFaction(userId, guildId);
    if (!faction) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Not in a Faction',
          'You must be in a faction to demote members.'
        )],
      });
      return;
    }

    // Demote member
    const result = await memberManager.demoteMember(faction.id, guildId, userId, targetUser.id);

    if (!result.success) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Demotion Failed',
          result.error!
        )],
      });
      return;
    }

    // Success
    await interaction.editReply({
      embeds: [factionFormatter.createSuccessEmbed(
        'Member Demoted',
        `**${targetUser.username}** has been demoted to **${factionFormatter.getRoleName('acolyte')}** in **${faction.name}**.`
      )],
    });

    logger.info(`User ${targetUser.id} demoted to Acolyte in faction ${faction.id}`);
  } catch (error) {
    logger.error('Error in faction demote:', error);
    throw error;
  }
}

/**
 * Handle /faction disband
 */
async function handleDisband(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const guild = interaction.guild as Guild;

  try {
    // Get user's faction
    const faction = await factionManager.getUserFaction(userId, guildId);
    if (!faction) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Not in a Faction',
          'You must be in a faction to disband it.'
        )],
      });
      return;
    }

    // Check if user is owner
    const canDisband = disbandManager.canDisband(faction.ownerId, userId);
    if (!canDisband.can) {
      await interaction.editReply({
        embeds: [factionFormatter.createErrorEmbed(
          'Permission Denied',
          canDisband.reason!
        )],
      });
      return;
    }

    // Create confirmation button
    const confirmButton = new ButtonBuilder()
      .setCustomId('confirm_disband')
      .setLabel('Yes, Disband Faction')
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId('cancel_disband')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

    // Send confirmation message
    await interaction.editReply({
      embeds: [factionFormatter.createWarningEmbed(
        'Disband Faction',
        `Are you sure you want to disband **${faction.name}**?\n\n` +
        `⚠️ **This action cannot be undone!**\n\n` +
        `**What will happen:**\n` +
        `• All ${faction.members.length} members will be removed\n` +
        `• The faction role and voice channel will be deleted\n` +
        `• Treasury balance of ${factionFormatter.formatCoins(faction.treasury)} coins will be **lost forever**\n` +
        `• All faction data will be permanently deleted\n\n` +
        `This confirmation expires in 30 seconds.`
      )],
      components: [row],
    });

    // Create collector for button interactions
    const response = await interaction.fetchReply();
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 30000, // 30 seconds
    });

    collector.on('collect', async (buttonInteraction) => {
      // Only the owner can respond
      if (buttonInteraction.user.id !== userId) {
        await buttonInteraction.reply({
          content: '❌ Only the Overseer can confirm this action!',
          ephemeral: true,
        });
        return;
      }

      if (buttonInteraction.customId === 'confirm_disband') {
        // Disband faction
        await buttonInteraction.update({
          embeds: [factionFormatter.createWarningEmbed(
            'Disbanding Faction...',
            'Please wait while the faction is being disbanded.'
          )],
          components: [],
        });

        const result = await disbandManager.disbandFaction(faction.id, guildId, guild, 'manual');

        if (result) {
          await interaction.editReply({
            embeds: [factionFormatter.createSuccessEmbed(
              'Faction Disbanded',
              `**${faction.name}** has been permanently disbanded.\n\n` +
              `All members have been notified and removed from the faction.`
            )],
            components: [],
          });

          logger.info(`Faction ${faction.id} disbanded by owner ${userId}`);
        } else {
          await interaction.editReply({
            embeds: [factionFormatter.createErrorEmbed(
              'Disband Failed',
              'An error occurred while disbanding the faction. Please try again or contact an administrator.'
            )],
            components: [],
          });
        }

        collector.stop();
      } else if (buttonInteraction.customId === 'cancel_disband') {
        // Cancel disband
        await buttonInteraction.update({
          embeds: [factionFormatter.createSuccessEmbed(
            'Disband Cancelled',
            `**${faction.name}** will not be disbanded.`
          )],
          components: [],
        });

        logger.info(`Faction ${faction.id} disband cancelled by owner ${userId}`);
        collector.stop();
      }
    });

    collector.on('end', async (_collected, reason) => {
      if (reason === 'time') {
        // Confirmation expired
        await interaction.editReply({
          embeds: [factionFormatter.createWarningEmbed(
            'Confirmation Expired',
            'The disband confirmation has expired. Your faction has not been disbanded.'
          )],
          components: [],
        });
      }
    });
  } catch (error) {
    logger.error('Error in faction disband:', error);
    throw error;
  }
}

/**
 * Handle /faction ledger
 */
async function handleLedger(interaction: ChatInputCommandInteraction): Promise<void> {
  const factionName = interaction.options.getString('name');
  const page = interaction.options.getInteger('page') || 1;
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  try {
    let faction;

    if (factionName) {
      // Get faction by name
      faction = await factionManager.getFactionByName(factionName, guildId);
      if (!faction) {
        await interaction.editReply({
          embeds: [factionFormatter.createErrorEmbed(
            'Faction Not Found',
            `No faction with the name "${factionName}" exists.`
          )],
        });
        return;
      }
    } else {
      // Get user's current faction
      faction = await factionManager.getUserFaction(userId, guildId);
      if (!faction) {
        await interaction.editReply({
          embeds: [factionFormatter.createErrorEmbed(
            'Not in a Faction',
            'You are not currently in a faction. Use `/faction create` to start one or get invited to join one.'
          )],
        });
        return;
      }
    }

    // Get ledger entries (10 per page)
    const entriesPerPage = 10;
    const offset = (page - 1) * entriesPerPage;
    const ledgerEntries = await factionLedgerService.getLedgerEntries(
      faction.id,
      guildId,
      entriesPerPage,
      offset
    );
    const totalEntries = await factionLedgerService.getLedgerCount(faction.id, guildId);

    if (ledgerEntries.length === 0) {
      await interaction.editReply({
        embeds: [factionFormatter.createWarningEmbed(
          'No Transactions',
          `**${faction.name}** has no transaction history yet.\n\n` +
          `Deposits and withdrawals will appear here once transactions are made.`
        )],
      });
      return;
    }

    // Create ledger embed
    const embed = factionFormatter.createLedgerEmbed(
      faction.name,
      ledgerEntries,
      page,
      totalEntries,
      entriesPerPage
    );

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error('Error in faction ledger:', error);
    throw error;
  }
}

/**
 * Handle /faction status
 */
async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  try {
    // Get user's faction
    const user = await database.users.findOne({ id: userId, guildId });
    if (!user || !user.currentFaction) {
      await interaction.editReply({
        content: '❌ You are not in a faction.\n' +
          'Join a faction or create one with `/faction create` to view faction status.',
      });
      return;
    }

    // Get faction data
    const faction = await database.factions.findOne({ id: user.currentFaction, guildId });
    if (!faction) {
      await interaction.editReply({
        content: '❌ Faction not found. This shouldn\'t happen!',
      });
      return;
    }

    // Get faction multiplier
    const factionMultiplier = faction.coinMultiplier ?? 1.0;

    // Get member count
    const memberCount = faction.members?.length ?? 0;

    // Build embed
    const embedColor = factionMultiplier > 1.0 ? 0x00ff00 : factionMultiplier < 1.0 ? 0xff0000 : 0x3498db;
    
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`🏴 Faction Status: ${faction.name}`)
      .setTimestamp();

    // Faction information
    embed.addFields(
      {
        name: '📊 Faction Information',
        value:
          `Level: ${faction.level ?? 1} 🎖️\n` +
          `Members: ${memberCount} 👥\n` +
          `Treasury: ${faction.treasury.toLocaleString()} 💰\n` +
          `XP: ${faction.xp.toLocaleString()} ⭐`,
        inline: false,
      },
      {
        name: '💰 Coin Multiplier',
        value:
          `Faction Multiplier: ${factionMultiplier.toFixed(2)}x\n\n` +
          `This multiplier applies to all faction members' coin earnings ` +
          `(VC time, quests, admin additions).`,
        inline: false,
      }
    );

    // Recent activity (if available)
    // Note: This could be enhanced with actual quest/activity stats
    embed.addFields({
      name: '📈 Recent Activity',
      value:
        `Daily Quests Completed: ${faction.dailyQuestsCompleted ?? 0}\n` +
        `Weekly Quests Completed: ${faction.weeklyQuestsCompleted ?? 0}\n` +
        `Total VC Time: ${faction.totalVcTime ? Math.floor(faction.totalVcTime / (1000 * 60 * 60)) : 0} hours`,
      inline: false,
    });

    embed.setFooter({ text: `Requested by ${interaction.user.username}` });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in faction status:', error);
    await interaction.editReply({
      content: '❌ An error occurred while fetching faction status. Please try again.',
    });
  }
}
