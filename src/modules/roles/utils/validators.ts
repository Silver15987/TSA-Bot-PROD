import { RoleType } from '../../../types/database';
import { getAllRoleTypes } from '../types/roleDefinitions';

/**
 * Validate role type
 */
export function isValidRoleType(roleType: string): roleType is RoleType {
  return getAllRoleTypes().includes(roleType as RoleType);
}

/**
 * Validate user has role
 */
export function validateUserHasRole(userRole: RoleType | null | undefined): boolean {
  return userRole !== null && userRole !== undefined;
}

/**
 * Validate target user ID format (Discord snowflake)
 */
export function isValidUserId(userId: string): boolean {
  // Discord user IDs are 17-19 digit numbers
  return /^\d{17,19}$/.test(userId);
}

/**
 * Validate amount is positive
 */
export function isValidAmount(amount: number): boolean {
  return amount > 0 && Number.isFinite(amount);
}

/**
 * Validate quest ID format
 */
export function isValidQuestId(questId: string): boolean {
  // Quest IDs typically start with 'quest_' or are alphanumeric
  return questId.length > 0 && /^[a-zA-Z0-9_-]+$/.test(questId);
}

