import { GuildMember } from 'discord.js';
import { configManager } from '../../../core/configManager';
import { PermissionCheckResult } from '../types';
import logger from '../../../core/logger';

/**
 * Permission Service
 * Handles role-based permission checks for admin commands
 */
export class PermissionService {
  /**
   * Check if a member has staff permissions
   */
  hasStaffPermission(member: GuildMember, guildId: string): PermissionCheckResult {
    try {
      const config = configManager.getConfig(guildId);

      // Check if staff roles are configured
      if (!config.admin?.staffRoleIds || config.admin.staffRoleIds.length === 0) {
        logger.warn(`No staff roles configured for guild ${guildId}`);
        return {
          hasPermission: false,
          reason: 'Staff roles have not been configured. Please ask an administrator to set up staff roles.',
        };
      }

      // Check if member has any of the staff roles
      const hasStaffRole = member.roles.cache.some(role =>
        config.admin.staffRoleIds.includes(role.id)
      );

      if (!hasStaffRole) {
        return {
          hasPermission: false,
          reason: 'You do not have the required staff role to use this command.',
        };
      }

      return { hasPermission: true };
    } catch (error) {
      logger.error('Error checking staff permissions:', error);
      return {
        hasPermission: false,
        reason: 'An error occurred while checking permissions.',
      };
    }
  }

  /**
   * Get configured staff role IDs for a guild
   */
  getStaffRoleIds(guildId: string): string[] {
    try {
      const config = configManager.getConfig(guildId);
      return config.admin?.staffRoleIds || [];
    } catch (error) {
      logger.error('Error getting staff role IDs:', error);
      return [];
    }
  }

  /**
   * Get audit log channel ID for a guild
   */
  getAuditLogChannelId(guildId: string): string | null {
    try {
      const config = configManager.getConfig(guildId);
      return config.admin?.auditLogChannelId || null;
    } catch (error) {
      logger.error('Error getting audit log channel ID:', error);
      return null;
    }
  }
}

export const permissionService = new PermissionService();
