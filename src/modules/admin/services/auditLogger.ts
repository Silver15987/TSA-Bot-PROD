import { Client, TextChannel, NewsChannel, VoiceChannel, EmbedBuilder } from 'discord.js';
import { UserAuditLogData, FactionAuditLogData } from '../types';
import { permissionService } from './permissionService';
import logger from '../../../core/logger';

/**
 * Audit Logger Service
 * Handles sending audit logs to configured channel
 */
export class AuditLogger {
  /**
   * Log a user economy action (add/remove coins)
   */
  async logUserEconomyAction(client: Client, data: UserAuditLogData): Promise<void> {
    try {
      const channelId = permissionService.getAuditLogChannelId(data.guildId);
      if (!channelId) {
        logger.warn(`No audit log channel configured for guild ${data.guildId}`);
        return;
      }

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel || channel instanceof VoiceChannel)) {
        logger.error(`Audit log channel ${channelId} not found or is not a text/announcement channel`);
        return;
      }

      const embed = this.createUserEconomyEmbed(data);
      await channel.send({ embeds: [embed] });

      logger.info(`Audit log sent for ${data.actionType}: ${data.staffUsername} → ${data.targetUsername} (${data.amount} coins)`);
    } catch (error) {
      logger.error('Error sending user economy audit log:', error);
    }
  }

  /**
   * Log a faction economy action (add/remove coins from treasury)
   */
  async logFactionEconomyAction(client: Client, data: FactionAuditLogData): Promise<void> {
    try {
      const channelId = permissionService.getAuditLogChannelId(data.guildId);
      if (!channelId) {
        logger.warn(`No audit log channel configured for guild ${data.guildId}`);
        return;
      }

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel || channel instanceof VoiceChannel)) {
        logger.error(`Audit log channel ${channelId} not found or is not a text/announcement channel`);
        return;
      }

      const embed = this.createFactionEconomyEmbed(data);
      await channel.send({ embeds: [embed] });

      logger.info(`Audit log sent for ${data.actionType}: ${data.staffUsername} → ${data.factionName} (${data.amount} coins)`);
    } catch (error) {
      logger.error('Error sending faction economy audit log:', error);
    }
  }

  /**
   * Create embed for user economy action
   */
  private createUserEconomyEmbed(data: UserAuditLogData): EmbedBuilder {
    const isAdd = data.actionType === 'user_add_coins';
    const color = isAdd ? 0x2ecc71 : 0xe74c3c; // Green for add, red for remove

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${isAdd ? '💰 Coins Added' : '💸 Coins Removed'}`)
      .setDescription(`**Staff Action: ${isAdd ? 'Add' : 'Remove'} Coins**`)
      .addFields(
        {
          name: '👤 Target User',
          value: `<@${data.targetUserId}>\n\`${data.targetUsername}\``,
          inline: true,
        },
        {
          name: '👮 Staff Member',
          value: `<@${data.staffUserId}>\n\`${data.staffUsername}\``,
          inline: true,
        },
        {
          name: '\u200b',
          value: '\u200b',
          inline: true,
        },
        {
          name: `${isAdd ? '➕' : '➖'} Amount`,
          value: `\`${data.amount.toLocaleString()}\` coins`,
          inline: true,
        },
        {
          name: '💵 Balance Before',
          value: `\`${data.balanceBefore.toLocaleString()}\` coins`,
          inline: true,
        },
        {
          name: '💰 Balance After',
          value: `\`${data.balanceAfter.toLocaleString()}\` coins`,
          inline: true,
        }
      )
      .setFooter({ text: `User ID: ${data.targetUserId}` })
      .setTimestamp(data.timestamp);

    return embed;
  }

  /**
   * Create embed for faction economy action
   */
  private createFactionEconomyEmbed(data: FactionAuditLogData): EmbedBuilder {
    const isAdd = data.actionType === 'faction_add_coins';
    const color = isAdd ? 0x9b59b6 : 0xe67e22; // Purple for add, orange for remove

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${isAdd ? '🏛️ Faction Treasury Added' : '🏛️ Faction Treasury Removed'}`)
      .setDescription(`**Staff Action: ${isAdd ? 'Add' : 'Remove'} Coins from Faction**`)
      .addFields(
        {
          name: '🏰 Target Faction',
          value: `**${data.factionName}**\n\`${data.factionId}\``,
          inline: true,
        },
        {
          name: '👮 Staff Member',
          value: `<@${data.staffUserId}>\n\`${data.staffUsername}\``,
          inline: true,
        },
        {
          name: '\u200b',
          value: '\u200b',
          inline: true,
        },
        {
          name: `${isAdd ? '➕' : '➖'} Amount`,
          value: `\`${data.amount.toLocaleString()}\` coins`,
          inline: true,
        },
        {
          name: '💵 Treasury Before',
          value: `\`${data.treasuryBefore.toLocaleString()}\` coins`,
          inline: true,
        },
        {
          name: '💰 Treasury After',
          value: `\`${data.treasuryAfter.toLocaleString()}\` coins`,
          inline: true,
        }
      )
      .setFooter({ text: `Faction ID: ${data.factionId}` })
      .setTimestamp(data.timestamp);

    return embed;
  }
}

export const auditLogger = new AuditLogger();
