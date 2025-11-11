import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { statusService } from '../modules/status/services/statusService';
import { multiplierCalculator } from '../modules/status/services/multiplierCalculator';
import { permissionService } from '../modules/admin/services/permissionService';
import { database } from '../database/client';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('multiplier-admin')
    .setDescription('Admin commands for managing user multipliers (Staff only)')
    .addSubcommand(subcommand =>
      subcommand
        .setName('toggle')
        .setDescription('Enable or disable multipliers for a user')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('The user to toggle multipliers for')
            .setRequired(true)
        )
        .addBooleanOption(option =>
          option
            .setName('enabled')
            .setDescription('Whether multipliers should be enabled')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View a user\'s multiplier status')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('The user to view')
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const guildId = interaction.guildId!;
      const member = interaction.member;

      // Check if member exists (should always be true in guild)
      if (!member || typeof member.permissions === 'string') {
        await interaction.reply({
          content: '❌ Unable to verify permissions.',
          ephemeral: true,
        });
        return;
      }

      // Check staff permissions
      const permissionCheck = permissionService.hasStaffPermission(member as any, guildId);
      if (!permissionCheck.hasPermission) {
        await interaction.reply({
          content: `❌ ${permissionCheck.reason}`,
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'toggle') {
        await handleToggle(interaction, guildId);
      } else if (subcommand === 'view') {
        await handleView(interaction, guildId);
      }
    } catch (error) {
      logger.error('Error in multiplier-admin command:', error);
      await interaction.editReply({
        embeds: [createErrorEmbed('Error', 'An unexpected error occurred.')],
      });
    }
  },
};

async function handleToggle(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const targetUser = interaction.options.getUser('user', true);
  const enabled = interaction.options.getBoolean('enabled', true);

  const result = await statusService.setMultiplierEnabled(targetUser.id, guildId, enabled);

  if (!result.success) {
    await interaction.editReply({
      embeds: [createErrorEmbed('Failed to Toggle Multiplier', result.error || 'An unknown error occurred')],
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(enabled ? 0x00ff00 : 0xff0000)
    .setTitle(`✅ Multiplier ${enabled ? 'Enabled' : 'Disabled'}`)
    .setDescription(`Multipliers have been ${enabled ? 'enabled' : 'disabled'} for ${targetUser}`)
    .addFields({
      name: 'Status',
      value: enabled ? '🟢 Enabled' : '🔴 Disabled',
      inline: true,
    })
    .setFooter({ text: `Staff: ${interaction.user.username}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });

  logger.info(`Staff ${interaction.user.username} ${enabled ? 'enabled' : 'disabled'} multipliers for ${targetUser.username}`);
}

async function handleView(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const targetUser = interaction.options.getUser('user', true);

  const user = await database.users.findOne({ id: targetUser.id, guildId });
  if (!user) {
    await interaction.editReply({
      embeds: [createErrorEmbed('User Not Found', 'This user is not registered in the database.')],
    });
    return;
  }

  // Get multiplier status
  const multiplierEnabled = user.multiplierEnabled ?? true;
  const statuses = await statusService.getUserStatuses(targetUser.id, guildId);
  const items = await statusService.getUserItems(targetUser.id, guildId);
  
  // Calculate current multiplier
  let totalMultiplier = 1.0;
  if (multiplierEnabled) {
    try {
      totalMultiplier = await multiplierCalculator.calculateTotalMultiplier(targetUser.id, guildId);
    } catch (error) {
      logger.warn(`Failed to calculate multiplier for display:`, error);
    }
  }

  // Calculate user multiplier from statuses and items
  let userMultiplier = 1.0;
  for (const status of statuses) {
    userMultiplier *= status.multiplier;
  }
  for (const item of items) {
    userMultiplier *= item.multiplier;
  }

  // Get faction multiplier if user is in a faction
  let factionMultiplier = 1.0;
  if (user.currentFaction) {
    try {
      const faction = await database.factions.findOne({ id: user.currentFaction, guildId });
      if (faction) {
        factionMultiplier = faction.coinMultiplier ?? 1.0;
      }
    } catch (error) {
      logger.warn(`Failed to get faction multiplier:`, error);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(multiplierEnabled ? 0x00ff00 : 0xff0000)
    .setTitle(`Multiplier Status for ${targetUser.username}`)
    .addFields(
      {
        name: 'Status',
        value: multiplierEnabled ? '🟢 Enabled' : '🔴 Disabled',
        inline: true,
      },
      {
        name: 'Total Multiplier',
        value: `${totalMultiplier.toFixed(2)}x`,
        inline: true,
      },
      {
        name: 'Faction Multiplier',
        value: `${factionMultiplier.toFixed(2)}x`,
        inline: true,
      },
      {
        name: 'User Multiplier',
        value: `${userMultiplier.toFixed(2)}x`,
        inline: true,
      },
      {
        name: 'Active Statuses',
        value: statuses.length > 0 ? statuses.map(s => `• ${s.name} (${s.multiplier}x)`).join('\n') : 'None',
        inline: false,
      },
      {
        name: 'Active Items',
        value: items.length > 0 ? items.map(i => `• ${i.itemId} (${i.multiplier}x)`).join('\n') : 'None',
        inline: false,
      }
    )
    .setFooter({ text: `Requested by: ${interaction.user.username}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

function createErrorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(0xe74c3c);
}







