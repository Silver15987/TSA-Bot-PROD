import { Guild } from 'discord.js';
import { database } from '../../../database/client';
import { factionManager } from './factionManager';
import { memberHistoryManager } from './memberHistoryManager';
import { factionStatsTracker } from './factionStatsTracker';
import { factionAnnouncementService } from './factionAnnouncementService';
import { factionXpService } from './factionXpService';
import { sessionManager } from '../../voiceTracking/services/sessionManager';
import { MemberOperationResult } from '../types';
import { factionValidator } from '../utils/validators';
import logger from '../../../core/logger';

/**
 * Member Manager
 * Handles faction member operations (invite, kick, leave, transfer)
 */
export class MemberManager {
  /**
   * Check if user can be invited to faction
   */
  async canInviteUser(
    factionId: string,
    guildId: string,
    inviterId: string,
    targetUserId: string,
    maxMembers: number
  ): Promise<MemberOperationResult> {
    try {
      // Get faction
      const faction = await factionManager.getFactionById(factionId, guildId);
      if (!faction) {
        return {
          success: false,
          error: 'Faction not found',
        };
      }

      // Check inviter has permission (owner or officer)
      const permission = factionValidator.checkPermission(inviterId, faction, 'officer');
      if (!permission.hasPermission) {
        return {
          success: false,
          error: permission.reason!,
        };
      }

      // Check if target is already in a faction
      const targetFaction = await factionManager.getUserFaction(targetUserId, guildId);
      if (targetFaction) {
        return {
          success: false,
          error: `This user is already in a faction (**${targetFaction.name}**). They must leave before joining another.`,
        };
      }

      // Check if faction is full
      const capacityCheck = factionValidator.canAcceptNewMember(faction, maxMembers);
      if (!capacityCheck.valid) {
        return {
          success: false,
          error: capacityCheck.error!,
        };
      }

      return { success: true };
    } catch (error) {
      logger.error('Error checking if user can be invited:', error);
      return {
        success: false,
        error: 'An error occurred while validating the invite',
      };
    }
  }

  /**
   * Add member to faction
   */
  async addMember(
    factionId: string,
    guildId: string,
    userId: string,
    guild: Guild
  ): Promise<MemberOperationResult> {
    try {
      // Get faction
      const faction = await factionManager.getFactionById(factionId, guildId);
      if (!faction) {
        return {
          success: false,
          error: 'Faction not found',
        };
      }

      // Check if user is already a member
      if (faction.members.includes(userId)) {
        return {
          success: false,
          error: 'User is already a member of this faction',
        };
      }

      // Add member to faction
      const addResult = await factionManager.addMember(factionId, guildId, userId);
      if (!addResult) {
        return {
          success: false,
          error: 'Failed to add member to faction',
        };
      }

      // Fetch Discord member to get username and assign role
      let username = 'Unknown';
      try {
        const member = await guild.members.fetch(userId);
        username = member.user.username; // Get actual Discord username
        await member.roles.add(faction.roleId);
      } catch (error) {
        logger.error(`Failed to fetch member or assign faction role to user ${userId}:`, error);
        // Fallback to database username if Discord fetch fails
        const user = await database.users.findOne({ id: userId, guildId });
        username = user?.username || 'Unknown';
      }

      // Update user document
      await database.users.updateOne(
        { id: userId, guildId },
        {
          $set: {
            currentFaction: factionId,
            factionJoinDate: new Date(),
            updatedAt: new Date(),
          },
        }
      );

      // Add to member history
      await memberHistoryManager.addMemberToHistory(factionId, guildId, userId, username);

      // Award XP if this is a new member (not a rejoin)
      const membersWhoGaveXp = faction.membersWhoGaveXp || [];
      if (!membersWhoGaveXp.includes(userId)) {
        // Award 100 XP for new member join
        const xpResult = await factionXpService.addXp(
          factionId,
          guildId,
          100,
          'member_join'
        );

        // Add user to membersWhoGaveXp array atomically
        await database.factions.updateOne(
          { id: factionId, guildId },
          {
            $addToSet: { membersWhoGaveXp: userId },
            $set: { updatedAt: new Date() },
          }
        );

        if (xpResult.success && xpResult.leveledUp) {
          logger.info(
            `Faction ${faction.name} (${factionId}) leveled up to ${xpResult.newLevel} from new member join!`
          );
        }
      }

      // Send welcome message to faction VC
      await factionAnnouncementService.sendWelcomeMessage(
        guild.client,
        guildId,
        faction.channelId,
        faction.roleId,
        username
      );

      logger.info(`User ${userId} joined faction ${factionId}`);

      return { success: true };
    } catch (error) {
      logger.error('Error adding member to faction:', error);
      return {
        success: false,
        error: 'An error occurred while adding the member',
      };
    }
  }

  /**
   * Remove member from faction (kick)
   */
  async kickMember(
    factionId: string,
    guildId: string,
    kickerId: string,
    targetUserId: string,
    guild: Guild
  ): Promise<MemberOperationResult> {
    try {
      // Get faction
      const faction = await factionManager.getFactionById(factionId, guildId);
      if (!faction) {
        return {
          success: false,
          error: 'Faction not found',
        };
      }

      // Check kicker has permission (owner or officer)
      const permission = factionValidator.checkPermission(kickerId, faction, 'officer');
      if (!permission.hasPermission) {
        return {
          success: false,
          error: permission.reason!,
        };
      }

      // Cannot kick owner
      if (targetUserId === faction.ownerId) {
        return {
          success: false,
          error: 'Cannot kick the faction owner. The owner must transfer ownership or disband the faction.',
        };
      }

      // Officers can only kick regular members, not other officers or owner
      if (faction.officers.includes(kickerId) && faction.ownerId !== kickerId) {
        if (faction.officers.includes(targetUserId)) {
          return {
            success: false,
            error: 'Officers cannot kick other officers. Only the owner can do that.',
          };
        }
      }

      // Check if target is a member
      if (!faction.members.includes(targetUserId)) {
        return {
          success: false,
          error: 'This user is not a member of the faction',
        };
      }

      // Remove member from faction
      await this.removeMemberFromFaction(factionId, guildId, targetUserId, guild);

      logger.info(`User ${targetUserId} was kicked from faction ${factionId} by ${kickerId}`);

      return { success: true };
    } catch (error) {
      logger.error('Error kicking member:', error);
      return {
        success: false,
        error: 'An error occurred while kicking the member',
      };
    }
  }

  /**
   * Member leaves faction
   */
  async leaveFaction(
    factionId: string,
    guildId: string,
    userId: string,
    guild: Guild
  ): Promise<MemberOperationResult> {
    try {
      // Get faction
      const faction = await factionManager.getFactionById(factionId, guildId);
      if (!faction) {
        return {
          success: false,
          error: 'Faction not found',
        };
      }

      // Owner cannot leave - must transfer or disband
      if (userId === faction.ownerId) {
        return {
          success: false,
          error: 'As the faction owner, you cannot leave. You must either transfer ownership with `/faction transfer` or disband the faction with `/faction disband`.',
        };
      }

      // Check if user is a member
      if (!faction.members.includes(userId)) {
        return {
          success: false,
          error: 'You are not a member of this faction',
        };
      }

      // Remove member from faction
      await this.removeMemberFromFaction(factionId, guildId, userId, guild);

      logger.info(`User ${userId} left faction ${factionId}`);

      return { success: true };
    } catch (error) {
      logger.error('Error leaving faction:', error);
      return {
        success: false,
        error: 'An error occurred while leaving the faction',
      };
    }
  }

  /**
   * Transfer faction ownership
   */
  async transferOwnership(
    factionId: string,
    guildId: string,
    currentOwnerId: string,
    newOwnerId: string
  ): Promise<MemberOperationResult> {
    try {
      // Get faction
      const faction = await factionManager.getFactionById(factionId, guildId);
      if (!faction) {
        return {
          success: false,
          error: 'Faction not found',
        };
      }

      // Verify current owner
      if (faction.ownerId !== currentOwnerId) {
        return {
          success: false,
          error: 'Only the faction owner can transfer ownership',
        };
      }

      // Check if new owner is a member
      if (!faction.members.includes(newOwnerId)) {
        return {
          success: false,
          error: 'The new owner must be a current member of the faction',
        };
      }

      // Cannot transfer to self
      if (currentOwnerId === newOwnerId) {
        return {
          success: false,
          error: 'You are already the owner of this faction',
        };
      }

      // Transfer ownership
      const transferResult = await factionManager.transferOwnership(factionId, guildId, newOwnerId);
      if (!transferResult) {
        return {
          success: false,
          error: 'Failed to transfer ownership',
        };
      }

      // Optionally: Add old owner as officer if not already
      if (!faction.officers.includes(currentOwnerId)) {
        await database.factions.updateOne(
          { id: factionId, guildId },
          {
            $addToSet: { officers: currentOwnerId },
          }
        );
      }

      logger.info(`Faction ${factionId} ownership transferred from ${currentOwnerId} to ${newOwnerId}`);

      return { success: true };
    } catch (error) {
      logger.error('Error transferring ownership:', error);
      return {
        success: false,
        error: 'An error occurred while transferring ownership',
      };
    }
  }

  /**
   * Helper: Remove member from faction (cleanup)
   * Used by kick and leave
   */
  private async removeMemberFromFaction(
    factionId: string,
    guildId: string,
    userId: string,
    guild: Guild
  ): Promise<void> {
    // Get faction to get role ID
    const faction = await factionManager.getFactionById(factionId, guildId);
    if (!faction) {
      throw new Error('Faction not found');
    }

    // EDGE CASE: Check if user is currently in faction VC
    const activeSession = await sessionManager.getSession(userId, guildId);
    if (activeSession && activeSession.factionId === factionId) {
      // User is actively in faction VC - finalize their session
      logger.info(`User ${userId} is leaving faction ${factionId} while in faction VC - finalizing session`);

      const sessionDuration = sessionManager.calculateDuration(activeSession);

      // Add the current session time to faction stats before they leave
      await factionStatsTracker.finalizeActiveVcSession(
        factionId,
        guildId,
        userId,
        activeSession.joinedAt
      );

      logger.info(`Finalized ${sessionDuration}ms of faction VC time for user ${userId} leaving faction ${factionId}`);
    }

    // Finalize member history (sets leftAt timestamp)
    await memberHistoryManager.finalizeMemberHistory(factionId, guildId, userId);

    // Remove from faction members
    const removeResult = await factionManager.removeMember(factionId, guildId, userId);
    if (!removeResult) {
      throw new Error('Failed to remove member from faction');
    }

    // Update user document (reset current faction and factionVcTime)
    await database.users.updateOne(
      { id: userId, guildId },
      {
        $set: {
          currentFaction: null,
          factionJoinDate: null,
          factionVcTime: 0, // Reset faction VC time for current faction
          updatedAt: new Date(),
        },
      }
    );

    // Remove faction role from user
    try {
      const member = await guild.members.fetch(userId);
      await member.roles.remove(faction.roleId);
    } catch (error) {
      logger.error(`Failed to remove faction role from user ${userId}:`, error);
    }
  }

  /**
   * Promote member to Warden (officer)
   */
  async promoteMember(
    factionId: string,
    guildId: string,
    promoterId: string,
    targetUserId: string
  ): Promise<MemberOperationResult> {
    try {
      // Get faction
      const faction = await factionManager.getFactionById(factionId, guildId);
      if (!faction) {
        return {
          success: false,
          error: 'Faction not found',
        };
      }

      // Only the Overseer (owner) can promote
      if (faction.ownerId !== promoterId) {
        return {
          success: false,
          error: 'Only the Overseer can promote members to Warden.',
        };
      }

      // Validate promotion
      const canPromote = factionValidator.canPromote(targetUserId, faction);
      if (!canPromote.valid) {
        return {
          success: false,
          error: canPromote.error!,
        };
      }

      // Add to officers array
      await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $addToSet: { officers: targetUserId },
          $set: { updatedAt: new Date() },
        }
      );

      logger.info(`User ${targetUserId} promoted to Warden in faction ${factionId}`);

      return { success: true };
    } catch (error) {
      logger.error('Error promoting member:', error);
      return {
        success: false,
        error: 'An error occurred while promoting the member',
      };
    }
  }

  /**
   * Demote Warden (officer) to Acolyte (member)
   */
  async demoteMember(
    factionId: string,
    guildId: string,
    demoterId: string,
    targetUserId: string
  ): Promise<MemberOperationResult> {
    try {
      // Get faction
      const faction = await factionManager.getFactionById(factionId, guildId);
      if (!faction) {
        return {
          success: false,
          error: 'Faction not found',
        };
      }

      // Only the Overseer (owner) can demote
      if (faction.ownerId !== demoterId) {
        return {
          success: false,
          error: 'Only the Overseer can demote Wardens.',
        };
      }

      // Validate demotion
      const canDemote = factionValidator.canDemote(targetUserId, faction);
      if (!canDemote.valid) {
        return {
          success: false,
          error: canDemote.error!,
        };
      }

      // Remove from officers array
      await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $pull: { officers: targetUserId },
          $set: { updatedAt: new Date() },
        }
      );

      logger.info(`User ${targetUserId} demoted to Acolyte in faction ${factionId}`);

      return { success: true };
    } catch (error) {
      logger.error('Error demoting member:', error);
      return {
        success: false,
        error: 'An error occurred while demoting the member',
      };
    }
  }
}

export const memberManager = new MemberManager();
