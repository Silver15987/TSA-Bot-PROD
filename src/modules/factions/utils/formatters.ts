import { FactionDocument } from '../../../types/database';
import { FactionRole } from '../types';
import { EmbedBuilder } from 'discord.js';

/**
 * Faction Formatters
 * Formatting functions for faction display
 */
export class FactionFormatter {
  /**
   * Format faction role with proper display name
   */
  formatRole(role: FactionRole): string {
    const roleNames: Record<FactionRole, string> = {
      overseer: '👑 Overseer',
      warden: '⚔️ Warden',
      acolyte: '🗡️ Acolyte',
    };
    return roleNames[role];
  }

  /**
   * Get role display name without emoji
   */
  getRoleName(role: FactionRole): string {
    const roleNames: Record<FactionRole, string> = {
      overseer: 'Overseer',
      warden: 'Warden',
      acolyte: 'Acolyte',
    };
    return roleNames[role];
  }

  /**
   * Format coins with commas
   */
  formatCoins(amount: number): string {
    return amount.toLocaleString();
  }

  /**
   * Format time duration in milliseconds to human-readable format
   */
  formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Format date to relative time
   */
  formatRelativeTime(date: Date): string {
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (diff < 0) {
      return 'Overdue';
    }

    if (days > 0) {
      return `in ${days} day${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      return `in ${hours} hour${hours > 1 ? 's' : ''}`;
    } else if (minutes > 0) {
      return `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      return `in ${seconds} second${seconds > 1 ? 's' : ''}`;
    }
  }

  /**
   * Create faction info embed
   */
  createFactionInfoEmbed(faction: FactionDocument, ownerUsername: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`⚔️ ${faction.name}`)
      .setColor(0x3498db)
      .addFields(
        {
          name: '👑 Owner',
          value: ownerUsername,
          inline: true,
        },
        {
          name: '👥 Members',
          value: `${faction.members.length} members`,
          inline: true,
        },
        {
          name: '📊 Level',
          value: `Level ${faction.level}`,
          inline: true,
        },
        {
          name: '💰 Treasury',
          value: `${this.formatCoins(faction.treasury)} coins`,
          inline: true,
        },
        {
          name: '📅 Next Upkeep',
          value: this.formatRelativeTime(faction.nextUpkeepDate),
          inline: true,
        },
        {
          name: '💵 Upkeep Cost',
          value: `${this.formatCoins(faction.upkeepAmount)} coins/day`,
          inline: true,
        },
        {
          name: '⏱️ Total VC Time',
          value: this.formatDuration(faction.totalVcTime),
          inline: true,
        },
        {
          name: '📈 Total Deposited',
          value: `${this.formatCoins(faction.totalDeposited)} coins`,
          inline: true,
        },
        {
          name: '📉 Total Withdrawn',
          value: `${this.formatCoins(faction.totalWithdrawn)} coins`,
          inline: true,
        }
      )
      .setTimestamp(faction.createdAt)
      .setFooter({ text: `Created` });

    // Add officers if any
    if (faction.officers.length > 0) {
      embed.addFields({
        name: '⭐ Officers',
        value: `${faction.officers.length} officer${faction.officers.length > 1 ? 's' : ''}`,
        inline: false,
      });
    }

    // Add war stats if any
    const totalWars = faction.warVictories + faction.warLosses + faction.warDraws;
    if (totalWars > 0) {
      embed.addFields({
        name: '⚔️ War Record',
        value: `${faction.warVictories}W - ${faction.warLosses}L - ${faction.warDraws}D`,
        inline: false,
      });
    }

    return embed;
  }

  /**
   * Create faction list embed
   */
  createFactionListEmbed(factions: FactionDocument[], guildName: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`⚔️ Factions in ${guildName}`)
      .setColor(0x3498db)
      .setDescription(
        factions.length === 0
          ? 'No factions have been created yet. Use `/faction create` to start one!'
          : `Total Factions: ${factions.length}`
      );

    if (factions.length > 0) {
      // Sort factions by member count (descending)
      const sortedFactions = factions.sort((a, b) => b.members.length - a.members.length);

      // Create faction list (max 10)
      const factionList = sortedFactions.slice(0, 10).map((faction, index) => {
        const trophy = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : '⚔️';
        return `${trophy} **${faction.name}**\n` +
          `└ ${faction.members.length} members • ${this.formatCoins(faction.treasury)} coins • Level ${faction.level}`;
      }).join('\n\n');

      embed.addFields({
        name: 'Top Factions',
        value: factionList,
        inline: false,
      });

      if (sortedFactions.length > 10) {
        embed.setFooter({ text: `Showing 10 of ${sortedFactions.length} factions` });
      }
    }

    return embed;
  }

  /**
   * Create success embed
   */
  createSuccessEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`✅ ${title}`)
      .setDescription(description)
      .setColor(0x2ecc71);
  }

  /**
   * Create error embed
   */
  createErrorEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`❌ ${title}`)
      .setDescription(description)
      .setColor(0xe74c3c);
  }

  /**
   * Create warning embed
   */
  createWarningEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`⚠️ ${title}`)
      .setDescription(description)
      .setColor(0xf39c12);
  }
}

export const factionFormatter = new FactionFormatter();
