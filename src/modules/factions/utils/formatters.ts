import { FactionDocument, FactionLedgerEntry } from '../../../types/database';
import { FactionRole } from '../types';
import { EmbedBuilder } from 'discord.js';
import { formatDuration as sharedFormatDuration } from '../../../utils/timeFormatters';
import { upkeepManager } from '../services/upkeepManager';
import { factionXpService } from '../services/factionXpService';

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
    return sharedFormatDuration(ms, { shortFormat: true, includeSeconds: true });
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
   * Format XP progress for display
   * Shows current XP and XP needed for next level
   */
  formatXpProgress(currentXp: number, currentLevel: number): string {
    const xpForNextLevel = factionXpService.calculateXpForNextLevel(currentXp);
    
    if (currentLevel >= 100) {
      return `Max Level (${currentXp.toLocaleString()} XP)`;
    }
    
    return `${currentXp.toLocaleString()} XP\n${xpForNextLevel.toLocaleString()} XP to next level`;
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
          name: '⭐ XP Progress',
          value: this.formatXpProgress(faction.xp, faction.level),
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
          value: `${this.formatCoins(upkeepManager.calculateUpkeepCost(faction.members.length))} coins/day`,
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

  /**
   * Create ledger embed showing transaction history
   */
  createLedgerEmbed(
    factionName: string,
    entries: FactionLedgerEntry[],
    currentPage: number,
    totalEntries: number,
    entriesPerPage: number
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`📋 ${factionName} - Transaction Ledger`)
      .setColor(0x3498db)
      .setTimestamp();

    if (entries.length === 0) {
      embed.setDescription('No transactions found.');
      return embed;
    }

    // Format each entry
    const entryLines = entries.map((entry, index) => {
      const entryNumber = (currentPage - 1) * entriesPerPage + index + 1;
      const typeEmoji = entry.type === 'deposit' ? '⬆️' : '⬇️';
      const typeLabel = entry.type === 'deposit' ? 'Deposit' : 'Withdrawal';
      const amountColor = entry.type === 'deposit' ? '+' : '-';
      
      // Format timestamp (relative if recent, otherwise date)
      const timeAgo = this.formatTimeAgo(entry.createdAt);
      
      return `${entryNumber}. ${typeEmoji} **${typeLabel}**\n` +
        `   ${amountColor}${this.formatCoins(entry.amount)} coins by **${entry.username}**\n` +
        `   Balance: ${this.formatCoins(entry.balanceAfter)} coins • ${timeAgo}`;
    });

    embed.setDescription(entryLines.join('\n\n'));

    // Calculate pagination info
    const totalPages = Math.ceil(totalEntries / entriesPerPage);
    if (totalPages > 1) {
      embed.setFooter({
        text: `Page ${currentPage} of ${totalPages} • Showing ${entries.length} of ${totalEntries} entries`,
      });
    } else {
      embed.setFooter({
        text: `Showing ${entries.length} of ${totalEntries} entries`,
      });
    }

    return embed;
  }

  /**
   * Format time ago (e.g., "2 hours ago", "3 days ago")
   */
  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
      return 'just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }
}

export const factionFormatter = new FactionFormatter();
