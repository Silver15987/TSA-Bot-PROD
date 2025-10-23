/**
 * Admin Module Types
 */

/**
 * Admin action types
 */
export type AdminActionType =
  | 'user_add_coins'
  | 'user_remove_coins'
  | 'faction_add_coins'
  | 'faction_remove_coins';

/**
 * Result of a user economy admin operation
 */
export interface UserEconomyAdminResult {
  success: boolean;
  userId: string;
  username: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  error?: string;
}

/**
 * Result of a faction economy admin operation
 */
export interface FactionEconomyAdminResult {
  success: boolean;
  factionId: string;
  factionName: string;
  amount: number;
  treasuryBefore: number;
  treasuryAfter: number;
  error?: string;
}

/**
 * Audit log data for user economy actions
 */
export interface UserAuditLogData {
  actionType: 'user_add_coins' | 'user_remove_coins';
  staffUserId: string;
  staffUsername: string;
  targetUserId: string;
  targetUsername: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  guildId: string;
  timestamp: Date;
}

/**
 * Audit log data for faction economy actions
 */
export interface FactionAuditLogData {
  actionType: 'faction_add_coins' | 'faction_remove_coins';
  staffUserId: string;
  staffUsername: string;
  factionId: string;
  factionName: string;
  amount: number;
  treasuryBefore: number;
  treasuryAfter: number;
  guildId: string;
  timestamp: Date;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  hasPermission: boolean;
  reason?: string;
}
