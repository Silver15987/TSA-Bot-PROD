import { SlashCommandBuilder, ChatInputCommandInteraction, Guild } from 'discord.js';
import { database } from '../../../database/client';
import { configManager } from '../../../core/configManager';
import { factionManager } from '../services/factionManager';
import { discordResourceManager } from '../services/discordResourceManager';
import { factionValidator } from '../utils/validators';
import { factionFormatter } from '../utils/formatters';
import { factionLedgerService } from '../services/factionLedgerService';
import logger from '../../../core/logger';

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
        case 'ledger':
          await handleLedger(interaction);
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
