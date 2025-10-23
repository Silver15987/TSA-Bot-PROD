/**
 * Faction module types
 */

/**
 * Faction role hierarchy
 * Overseer: Faction leader (owner)
 * Warden: Officers with elevated permissions
 * Acolyte: Regular members
 */
export type FactionRole = 'overseer' | 'warden' | 'acolyte';

/**
 * Faction creation result
 */
export interface FactionCreationResult {
  success: boolean;
  factionId?: string;
  roleId?: string;
  channelId?: string;
  error?: string;
}

/**
 * Faction member info
 */
export interface FactionMemberInfo {
  userId: string;
  username: string;
  role: FactionRole;
  joinedAt: Date;
  coinsDeposited: number;
}

/**
 * Faction info for display
 */
export interface FactionInfo {
  id: string;
  name: string;
  ownerUsername: string;
  memberCount: number;
  treasury: number;
  level: number;
  upkeepDue: Date;
  totalVcTime: number;
}

/**
 * Faction validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Treasury operation result
 */
export interface TreasuryOperationResult {
  success: boolean;
  newBalance?: number;
  error?: string;
}

/**
 * Member operation result
 */
export interface MemberOperationResult {
  success: boolean;
  error?: string;
}

/**
 * Faction permission check
 */
export interface PermissionCheck {
  hasPermission: boolean;
  reason?: string;
}
