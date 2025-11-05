import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { database } from '../database/client';
import { statusService } from '../modules/status/services/statusService';
import { multiplierCalculator } from '../modules/status/services/multiplierCalculator';
import { roleStatusManager } from '../modules/roles/services/roleStatusManager';
import {
  formatMultiplier,
  getMultiplierColor,
  groupStatusesByType,
  formatStatusList,
  formatItemList,
} from '../modules/status/utils/statusFormatters';
import { StatusEntry } from '../types/database';
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
      const regularStatuses = await statusService.getUserStatuses(userId, guildId);
      const items = await statusService.getUserItems(userId, guildId);

      // Get role-based statuses (curses, blessings, etc.)
      const roleStatuses = await roleStatusManager.getActiveStatusesForUser(userId, guildId);
      
      // Convert role statuses to StatusEntry format
      const convertedRoleStatuses: StatusEntry[] = roleStatuses.map(roleStatus => {
        let name = '';
        let type: 'buff' | 'debuff' | 'status' = 'status';
        let multiplier = 1.0;

        switch (roleStatus.effectType) {
          case 'curse':
            type = 'debuff';
            const curseType = roleStatus.metadata?.curseType || 'unknown';
            const curseAmount = roleStatus.metadata?.amount || 0;
            if (curseType === 'earning_rate') {
              name = `Witch's Curse - ${curseAmount}% Earning Reduction`;
              multiplier = 1.0 - (curseAmount / 100); // e.g., 0.8 for 20% reduction
            } else if (curseType === 'instant_loss') {
              name = `Witch's Curse - Instant Loss`;
              multiplier = 1.0; // Instant loss doesn't affect multiplier
            } else {
              name = `Witch's Curse`;
            }
            break;
          case 'blessing':
            type = 'buff';
            const blessingBonus = roleStatus.metadata?.coinGainBonus || 0;
            name = `Enchanter's Blessing (+${blessingBonus}% coin gain)`;
            multiplier = 1.0 + (blessingBonus / 100); // e.g., 1.2 for 20% bonus
            break;
          case 'wanted':
            type = 'debuff';
            name = 'Wanted Status';
            multiplier = 0.1; // 10% coin gain (as per requirements)
            break;
          case 'protection':
            type = 'status';
            name = 'Guard Protection';
            multiplier = 1.0;
            break;
          case 'investment':
            type = 'status';
            name = 'Merchant Investment';
            multiplier = 1.0;
            break;
          case 'market_manipulation':
            type = 'status';
            const effect = roleStatus.metadata?.effect || 0;
            name = `Market Manipulation (${effect > 0 ? '+' : ''}${effect}%)`;
            multiplier = 1.0 + (effect / 100);
            break;
          default:
            name = `${roleStatus.roleType} ${roleStatus.effectType}`;
        }

        return {
          id: roleStatus.id,
          type,
          name,
          multiplier,
          expiresAt: roleStatus.expiresAt,
          source: 'role',
          metadata: {
            ...roleStatus.metadata,
            roleType: roleStatus.roleType,
            effectType: roleStatus.effectType,
            casterId: roleStatus.userId,
          },
        };
      });

      // Merge regular statuses with role statuses
      const statuses = [...regularStatuses, ...convertedRoleStatuses];

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


