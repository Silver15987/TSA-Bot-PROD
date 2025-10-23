import { Guild } from 'discord.js';
import { database } from '../../../database/client';
import { factionManager } from './factionManager';
import { discordResourceManager } from './discordResourceManager';
import { factionAnnouncementService } from './factionAnnouncementService';
import logger from '../../../core/logger';

/**
 * Disband Manager
 * Handles faction disbanding (manual and automatic)
 */
export class DisbandManager {
  /**
   * Disband a faction (soft delete - preserves historical data)
   * @param reason 'manual' or 'upkeep_failure'
   */
  async disbandFaction(
    factionId: string,
    guildId: string,
    guild: Guild,
    reason: 'manual' | 'upkeep_failure'
  ): Promise<boolean> {
    try {
      // Get faction
      const faction = await factionManager.getFactionById(factionId, guildId);
      if (!faction) {
        logger.warn(`Attempted to disband non-existent faction ${factionId}`);
        return false;
      }

      logger.info(`Disbanding faction ${faction.name} (${factionId}) - Reason: ${reason}`);

      // 1. Send insufficient funds message to faction VC (before deleting channel)
      if (reason === 'upkeep_failure') {
        const config = await import('../../../core/configManager').then(m => m.configManager.getConfig(guildId));
        await factionAnnouncementService.sendInsufficientFundsMessage(
          guild.client,
          faction.channelId,
          faction.roleId,
          faction.treasury,
          config.factions.dailyUpkeepCost
        );
      }

      // 2. Delete Discord resources (role and channel)
      await discordResourceManager.deleteFactionResources(guild, faction.roleId, faction.channelId);

      // 3. Finalize member history for all members
      await this.finalizeAllMemberHistory(faction.id, faction.members, guildId);

      // 4. Update all member documents (remove faction association, reset factionVcTime)
      await this.updateAllMembers(faction.members, guildId);

      // 5. Notify all members via DM
      await this.notifyMembers(faction.members, faction.name, reason, guild);

      // 6. Mark faction as disbanded (soft delete - keep data)
      await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $set: {
            disbanded: true,
            disbandedAt: new Date(),
            disbandedReason: reason,
            updatedAt: new Date(),
          },
        }
      );

      // 7. Send public faction disbanded announcement
      await factionAnnouncementService.sendFactionDisbandedAnnouncement(
        guild.client,
        guildId,
        faction.name,
        reason,
        faction.members.length
      );

      logger.info(`Successfully disbanded faction ${faction.name} (${factionId}) - Data preserved`);

      return true;
    } catch (error) {
      logger.error(`Failed to disband faction ${factionId}:`, error);
      return false;
    }
  }

  /**
   * Finalize member history for all members when faction is disbanded
   */
  private async finalizeAllMemberHistory(
    factionId: string,
    memberIds: string[],
    guildId: string
  ): Promise<void> {
    try {
      const now = new Date();

      // Update all member history entries to set leftAt date
      await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $set: {
            'memberHistory.$[member].leftAt': now,
          },
        },
        {
          arrayFilters: [
            {
              'member.userId': { $in: memberIds },
              'member.leftAt': null,
            },
          ],
        }
      );

      logger.debug(`Finalized member history for ${memberIds.length} members`);
    } catch (error) {
      logger.error('Failed to finalize member history:', error);
    }
  }

  /**
   * Update all member documents to remove faction association
   */
  private async updateAllMembers(memberIds: string[], guildId: string): Promise<void> {
    try {
      await database.users.updateMany(
        {
          id: { $in: memberIds },
          guildId,
        },
        {
          $set: {
            currentFaction: null,
            factionJoinDate: null,
            factionVcTime: 0, // Reset current faction VC time
            updatedAt: new Date(),
          },
        }
      );

      logger.debug(`Updated ${memberIds.length} member documents after faction disband`);
    } catch (error) {
      logger.error('Failed to update member documents:', error);
    }
  }

  /**
   * Notify all members that the faction has been disbanded
   */
  private async notifyMembers(
    memberIds: string[],
    factionName: string,
    reason: 'manual' | 'upkeep_failure',
    guild: Guild
  ): Promise<void> {
    const reasonText =
      reason === 'manual'
        ? 'The faction owner disbanded the faction.'
        : 'The faction ran out of funds for the daily upkeep cost.';

    const message =
      `**Faction Disbanded**\n\n` +
      `Your faction **${factionName}** has been disbanded.\n\n` +
      `**Reason:** ${reasonText}\n\n` +
      `All deposited coins have been consumed. You can create a new faction or join another faction.`;

    // Send DM to each member
    for (const memberId of memberIds) {
      try {
        const user = await guild.client.users.fetch(memberId);
        await user.send(message);
        logger.debug(`Sent disband notification to user ${memberId}`);
      } catch (error) {
        logger.warn(`Failed to send disband notification to user ${memberId}:`, error);
        // Continue even if DM fails (user might have DMs disabled)
      }
    }
  }

  /**
   * Check if faction can be disbanded
   */
  canDisband(ownerId: string, requesterId: string): { can: boolean; reason?: string } {
    if (ownerId !== requesterId) {
      return {
        can: false,
        reason: 'Only the faction owner can disband the faction.',
      };
    }

    return { can: true };
  }
}

export const disbandManager = new DisbandManager();
