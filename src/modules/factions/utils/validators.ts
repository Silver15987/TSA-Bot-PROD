import { FactionDocument } from '../../../types/database';
import { ValidationResult, PermissionCheck, FactionRole } from '../types';

/**
 * Faction Validators
 * Validation functions for faction operations
 */
export class FactionValidator {
  /**
   * Validate faction name
   */
  validateFactionName(name: string): ValidationResult {
    // Check if name is empty
    if (!name || name.trim().length === 0) {
      return {
        valid: false,
        error: 'Faction name cannot be empty',
      };
    }

    // Check length
    if (name.length < 3) {
      return {
        valid: false,
        error: 'Faction name must be at least 3 characters long',
      };
    }

    if (name.length > 32) {
      return {
        valid: false,
        error: 'Faction name cannot exceed 32 characters',
      };
    }

    // Check for valid characters (alphanumeric, spaces, hyphens, underscores)
    const validNameRegex = /^[a-zA-Z0-9 _-]+$/;
    if (!validNameRegex.test(name)) {
      return {
        valid: false,
        error: 'Faction name can only contain letters, numbers, spaces, hyphens, and underscores',
      };
    }

    // Check for profanity (basic list - can be expanded)
    const profanityList = ['fuck', 'shit', 'bitch', 'ass', 'damn', 'nigga', 'nigger', 'cunt'];
    const lowerName = name.toLowerCase();
    for (const word of profanityList) {
      if (lowerName.includes(word)) {
        return {
          valid: false,
          error: 'Faction name contains inappropriate language',
        };
      }
    }

    return { valid: true };
  }

  /**
   * Check if user has permission to perform action
   */
  checkPermission(
    userId: string,
    faction: FactionDocument,
    requiredRole: 'owner' | 'officer' | 'member'
  ): PermissionCheck {
    // Check if user is owner
    const isOwner = faction.ownerId === userId;

    // Check if user is officer
    const isOfficer = faction.officers.includes(userId);

    // Check if user is member
    const isMember = faction.members.includes(userId);

    // Permission hierarchy: owner > officer > member
    switch (requiredRole) {
      case 'owner':
        if (!isOwner) {
          return {
            hasPermission: false,
            reason: 'Only the faction owner can perform this action',
          };
        }
        break;

      case 'officer':
        if (!isOwner && !isOfficer) {
          return {
            hasPermission: false,
            reason: 'Only faction officers and the owner can perform this action',
          };
        }
        break;

      case 'member':
        if (!isMember) {
          return {
            hasPermission: false,
            reason: 'You must be a member of this faction to perform this action',
          };
        }
        break;
    }

    return { hasPermission: true };
  }

  /**
   * Get user's role in faction
   */
  getUserRole(userId: string, faction: FactionDocument): 'owner' | 'officer' | 'member' | null {
    if (faction.ownerId === userId) {
      return 'owner';
    }

    if (faction.officers.includes(userId)) {
      return 'officer';
    }

    if (faction.members.includes(userId)) {
      return 'member';
    }

    return null;
  }

  /**
   * Get user's faction role with proper naming (Overseer, Warden, Acolyte)
   */
  getUserFactionRole(userId: string, faction: FactionDocument): FactionRole | null {
    if (faction.ownerId === userId) {
      return 'overseer';
    }

    if (faction.officers.includes(userId)) {
      return 'warden';
    }

    if (faction.members.includes(userId)) {
      return 'acolyte';
    }

    return null;
  }

  /**
   * Check if user can be promoted
   */
  canPromote(targetUserId: string, faction: FactionDocument): ValidationResult {
    // Check if target is owner
    if (faction.ownerId === targetUserId) {
      return {
        valid: false,
        error: 'The Overseer cannot be promoted further.',
      };
    }

    // Check if target is already a warden (officer)
    if (faction.officers.includes(targetUserId)) {
      return {
        valid: false,
        error: 'This member is already a Warden.',
      };
    }

    // Check if target is a member
    if (!faction.members.includes(targetUserId)) {
      return {
        valid: false,
        error: 'This user is not a member of the faction.',
      };
    }

    return { valid: true };
  }

  /**
   * Check if user can be demoted
   */
  canDemote(targetUserId: string, faction: FactionDocument): ValidationResult {
    // Check if target is owner
    if (faction.ownerId === targetUserId) {
      return {
        valid: false,
        error: 'The Overseer cannot be demoted.',
      };
    }

    // Check if target is a warden (officer)
    if (!faction.officers.includes(targetUserId)) {
      return {
        valid: false,
        error: 'This member is not a Warden (already an Acolyte).',
      };
    }

    return { valid: true };
  }

  /**
   * Validate treasury amount
   */
  validateTreasuryAmount(amount: number, operation: 'deposit' | 'withdraw'): ValidationResult {
    if (amount <= 0) {
      return {
        valid: false,
        error: 'Amount must be greater than 0',
      };
    }

    if (!Number.isInteger(amount)) {
      return {
        valid: false,
        error: 'Amount must be a whole number',
      };
    }

    if (amount > 1000000000) {
      return {
        valid: false,
        error: 'Amount is too large',
      };
    }

    return { valid: true };
  }

  /**
   * Check if faction can accept new members
   */
  canAcceptNewMember(faction: FactionDocument, maxMembers: number): ValidationResult {
    if (faction.members.length >= maxMembers) {
      return {
        valid: false,
        error: `Faction is full (${faction.members.length}/${maxMembers} members)`,
      };
    }

    return { valid: true };
  }

  /**
   * Check if treasury has sufficient funds
   */
  hasSufficientFunds(faction: FactionDocument, amount: number): ValidationResult {
    if (faction.treasury < amount) {
      return {
        valid: false,
        error: `Insufficient treasury funds. Available: ${faction.treasury} coins, Required: ${amount} coins`,
      };
    }

    return { valid: true };
  }
}

export const factionValidator = new FactionValidator();
