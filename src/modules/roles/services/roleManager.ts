import { database } from '../../../database/client';
import { RoleType } from '../../../types/database';
import logger from '../../../core/logger';
import { ROLE_DEFINITIONS, getAllRoleTypes } from '../types/roleDefinitions';

export interface RoleAssignmentResult {
  success: boolean;
  error?: string;
  roleType?: RoleType;
}

/**
 * Role Manager
 * Handles role assignment, retrieval, and management
 */
export class RoleManager {
  /**
   * Get user's current role
   */
  async getUserRole(userId: string, guildId: string): Promise<RoleType | null> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      return user?.role || null;
    } catch (error) {
      logger.error(`Error getting user role for ${userId}:`, error);
      return null;
    }
  }

  /**
   * Set user's role
   */
  async setUserRole(
    userId: string,
    guildId: string,
    roleType: RoleType
  ): Promise<RoleAssignmentResult> {
    try {
      // Validate role type
      if (!getAllRoleTypes().includes(roleType)) {
        return {
          success: false,
          error: 'Invalid role type',
        };
      }

      // Update user document
      const result = await database.users.updateOne(
        { id: userId, guildId },
        {
          $set: {
            role: roleType,
            updatedAt: new Date(),
          },
        }
      );

      if (result.modifiedCount === 0) {
        // User might not exist
        const user = await database.users.findOne({ id: userId, guildId });
        if (!user) {
          return {
            success: false,
            error: 'User not found',
          };
        }
      }

      logger.info(`Assigned role ${roleType} to user ${userId} in guild ${guildId}`);
      return {
        success: true,
        roleType,
      };
    } catch (error) {
      logger.error(`Error setting user role for ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Relinquish user's current role
   */
  async relinquishRole(userId: string, guildId: string): Promise<RoleAssignmentResult> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      if (!user) {
        return {
          success: false,
          error: 'User not found',
        };
      }

      if (!user.role) {
        return {
          success: false,
          error: 'User does not have a role',
        };
      }

      const previousRole = user.role;

      // Remove role and reset progress
      await database.users.updateOne(
        { id: userId, guildId },
        {
          $set: {
            role: null,
            roleProgress: [],
            roleCooldowns: [],
            updatedAt: new Date(),
          },
        }
      );

      logger.info(`User ${userId} relinquished role ${previousRole} in guild ${guildId}`);
      return {
        success: true,
      };
    } catch (error) {
      logger.error(`Error relinquishing role for ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get all role definitions
   */
  getAllRoles() {
    return ROLE_DEFINITIONS;
  }

  /**
   * Check if user can unlock a role (has no role currently)
   */
  async canUnlockRole(userId: string, guildId: string): Promise<boolean> {
    try {
      const user = await database.users.findOne({ id: userId, guildId });
      return !user?.role; // Can unlock if no role
    } catch (error) {
      logger.error(`Error checking if user can unlock role for ${userId}:`, error);
      return false;
    }
  }

  /**
   * Get role definition
   */
  getRoleDefinition(roleType: RoleType) {
    return ROLE_DEFINITIONS[roleType];
  }
}

export const roleManager = new RoleManager();

