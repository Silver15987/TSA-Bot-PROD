import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { database } from '../database/client';
import { statusService } from '../modules/status/services/statusService';
import { multiplierCalculator } from '../modules/status/services/multiplierCalculator';
import {
  formatMultiplier,
  getMultiplierColor,
  groupStatusesByType,
  formatStatusList,
  formatItemList,
} from '../modules/status/utils/statusFormatters';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('View your active statuses, items, buffs, debuffs, and multiplier information'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.user.id;
      const guildId = interaction.guildId!;

      // Get user data
      const user = await database.users.findOne({ id: userId, guildId });

      if (!user) {
        await interaction.editReply({
          content: '❌ You are not registered in the database.\n' +
            'Join a voice channel or use `/register` to get started!',
        });
        return;
      }

      // Get statuses and items (with Redis caching)
      const statuses = await statusService.getUserStatuses(userId, guildId);
      const items = await statusService.getUserItems(userId, guildId);

      // Calculate multipliers
      const multiplierEnabled = user.multiplierEnabled ?? true;
      let totalMultiplier = 1.0;
      let factionMultiplier = 1.0;
      let userMultiplier = 1.0;

      if (multiplierEnabled) {
        try {
          totalMultiplier = await multiplierCalculator.calculateTotalMultiplier(userId, guildId);
          
          // Calculate user multiplier from statuses and items
          userMultiplier = 1.0;
          for (const status of statuses) {
            userMultiplier *= status.multiplier;
          }
          for (const item of items) {
            userMultiplier *= item.multiplier;
          }

          // Get faction multiplier if user is in a faction
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
        } catch (error) {
          logger.warn(`Failed to calculate multipliers:`, error);
        }
      }

      // Group statuses by type
      const grouped = groupStatusesByType(statuses);

      // Build embed
      const embedColor = multiplierEnabled
        ? getMultiplierColor(totalMultiplier)
        : 0xff0000; // Red if disabled

      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle('🎯 Your Status')
        .setThumbnail(interaction.user.displayAvatarURL())
        .setTimestamp();

      // Multiplier breakdown
      const multiplierField = {
        name: '💰 Multiplier Breakdown',
        value:
          `Total Multiplier: ${formatMultiplier(totalMultiplier)} ⭐\n` +
          `Faction Multiplier: ${user.currentFaction ? formatMultiplier(factionMultiplier) + ' 🏴' : 'N/A (Not in a faction)'}\n` +
          `Your Multiplier: ${formatMultiplier(userMultiplier)} 👤\n\n` +
          `Status: ${multiplierEnabled ? '🟢 Enabled' : '🔴 Disabled'}`,
        inline: false,
      };

      embed.addFields(multiplierField);

      // Active buffs
      if (grouped.buffs.length > 0) {
        embed.addFields({
          name: `✨ Active Buffs (${grouped.buffs.length})`,
          value: formatStatusList(grouped.buffs, 10, 'None'),
          inline: false,
        });
      } else {
        embed.addFields({
          name: '✨ Active Buffs',
          value: 'None',
          inline: false,
        });
      }

      // Active debuffs
      if (grouped.debuffs.length > 0) {
        embed.addFields({
          name: `🛡️ Active Debuffs (${grouped.debuffs.length})`,
          value: formatStatusList(grouped.debuffs, 10, 'None'),
          inline: false,
        });
      } else {
        embed.addFields({
          name: '🛡️ Active Debuffs',
          value: 'None',
          inline: false,
        });
      }

      // Active items
      if (items.length > 0) {
        embed.addFields({
          name: `📦 Active Items (${items.length})`,
          value: formatItemList(items, 10, 'None'),
          inline: false,
        });
      } else {
        embed.addFields({
          name: '📦 Active Items',
          value: 'None',
          inline: false,
        });
      }

      // Additional statuses (non-buff/debuff)
      if (grouped.statuses.length > 0) {
        embed.addFields({
          name: `📌 Other Statuses (${grouped.statuses.length})`,
          value: formatStatusList(grouped.statuses, 10, 'None'),
          inline: false,
        });
      }

      embed.setFooter({ text: `Requested by ${interaction.user.username}` });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error in status command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while fetching your status. Please try again.',
      });
    }
  },
};


