/**
 * Role Definitions
 * 
 * Defines all six roles with their abilities, stats, and mechanics
 */

import { RoleType } from '../../../types/database';

export interface RoleAbility {
  name: string;
  description: string;
  cost: number; // Coins cost
  cooldownHours: number;
  requiresFaction: boolean; // If true, user must be in a faction to use
  requiresTarget?: boolean; // If true, ability needs a target
  successRate?: number; // Base success rate (if applicable)
}

export interface RoleDefinition {
  type: RoleType;
  name: string;
  description: string;
  baseSuccessRate: number; // Base success rate for ability calculations
  abilities: RoleAbility[];
  counters: RoleType[]; // Roles this role counters
  weaknesses: RoleType[]; // Roles that counter this role
}

export const ROLE_DEFINITIONS: Record<RoleType, RoleDefinition> = {
  guard: {
    type: 'guard',
    name: 'Guard',
    description: 'Defensive role that protects faction members and treasury',
    baseSuccessRate: 50,
    abilities: [
      {
        name: 'protect',
        description: 'Protect a user or faction for 12 hours. Increases faction upkeep if protecting faction.',
        cost: 0, // Configurable per guild
        cooldownHours: 3,
        requiresFaction: false,
        requiresTarget: true,
      },
      {
        name: 'intercept',
        description: 'Intercept theft attempts on protected targets (reactive popup)',
        cost: 0,
        cooldownHours: 0,
        requiresFaction: false,
        requiresTarget: false,
        successRate: 50,
      },
      {
        name: 'bail',
        description: 'Remove Wanted status from a Thief by paying the steal amount from faction deposit',
        cost: 0, // Dynamic based on steal amount
        cooldownHours: 0,
        requiresFaction: true,
        requiresTarget: true,
      },
    ],
    counters: ['thief'],
    weaknesses: ['thief', 'witch'],
  },
  thief: {
    type: 'thief',
    name: 'Thief',
    description: 'Offensive role that steals coins from users and factions',
    baseSuccessRate: 50,
    abilities: [
      {
        name: 'steal',
        description: 'Attempt to steal coins from a user or faction. Success decreases with higher amounts.',
        cost: 0, // Configurable per attempt
        cooldownHours: 0, // Limited by daily count (1-2 per day)
        requiresFaction: false,
        requiresTarget: true,
        successRate: 50,
      },
    ],
    counters: [],
    weaknesses: ['guard', 'oracle'],
  },
  witch: {
    type: 'witch',
    name: 'Witch',
    description: 'Disruption role that weakens opponents with curses',
    baseSuccessRate: 0, // Variable based on coins spent
    abilities: [
      {
        name: 'curse',
        description: 'Cast a curse on a user or faction. Can maintain one curse at a time. Strength scales with coins spent.',
        cost: 0, // Variable based on curse strength
        cooldownHours: 0, // Can recast after current curse ends
        requiresFaction: false,
        requiresTarget: true,
      },
    ],
    counters: [],
    weaknesses: ['enchanter', 'oracle'],
  },
  oracle: {
    type: 'oracle',
    name: 'Oracle',
    description: 'Information role that detects threats and reveals identities',
    baseSuccessRate: 70,
    abilities: [
      {
        name: 'detect',
        description: 'Detect the identity of a Thief or Witch. Provides clues (250 coins each), 4th attempt is free.',
        cost: 250, // Per clue
        cooldownHours: 6,
        requiresFaction: false,
        requiresTarget: true,
        successRate: 70,
      },
      {
        name: 'auto-detect',
        description: 'Passive chance to detect when theft/curse occurs (immediate notification)',
        cost: 0,
        cooldownHours: 0,
        requiresFaction: false,
        requiresTarget: false,
      },
    ],
    counters: ['thief', 'witch'],
    weaknesses: [],
  },
  enchanter: {
    type: 'enchanter',
    name: 'Enchanter',
    description: 'Support role that buffs allies and removes curses',
    baseSuccessRate: 0, // Support role, no success rate needed
    abilities: [
      {
        name: 'bless',
        description: 'Apply blessing to user (+20% coin gain) or faction (+5% coin gain) for 6 hours. One blessing per Enchanter.',
        cost: 0, // Configurable
        cooldownHours: 12,
        requiresFaction: false,
        requiresTarget: true,
      },
      {
        name: 'charm',
        description: 'Instant coin boost to a user based on Enchanter\'s coins',
        cost: 0, // Variable
        cooldownHours: 12,
        requiresFaction: false,
        requiresTarget: true,
      },
      {
        name: 'dispel',
        description: 'Remove any active curse from a user or faction',
        cost: 0, // Configurable
        cooldownHours: 12,
        requiresFaction: false,
        requiresTarget: true,
      },
    ],
    counters: ['witch'],
    weaknesses: ['witch'],
  },
  merchant: {
    type: 'merchant',
    name: 'Merchant',
    description: 'Economic role that generates wealth through trade and investment',
    baseSuccessRate: 0, // Economic role, no success rate needed
    abilities: [
      {
        name: 'trade',
        description: 'Exchange coins with any user. 2% fee goes to Merchant.',
        cost: 0,
        cooldownHours: 0,
        requiresFaction: false,
        requiresTarget: true,
      },
      {
        name: 'market',
        description: 'Manipulate server-wide coin-earning rate by ±2% for 1 hour. Random direction. 7-day cooldown.',
        cost: 0, // Configurable
        cooldownHours: 168, // 7 days
        requiresFaction: false,
        requiresTarget: false,
      },
      {
        name: 'invest',
        description: 'Invest coins for 24 hours. Returns +1% (can be increased). Minimum 10k coins. Fails if cursed/stolen.',
        cost: 10000, // Minimum
        cooldownHours: 0, // Only one active investment at a time
        requiresFaction: false,
        requiresTarget: false,
      },
    ],
    counters: [],
    weaknesses: ['thief', 'witch'],
  },
};

/**
 * Get role definition by type
 */
export function getRoleDefinition(roleType: RoleType): RoleDefinition {
  return ROLE_DEFINITIONS[roleType];
}

/**
 * Get all role types
 */
export function getAllRoleTypes(): RoleType[] {
  return Object.keys(ROLE_DEFINITIONS) as RoleType[];
}

/**
 * Get ability definition
 */
export function getAbilityDefinition(roleType: RoleType, abilityName: string): RoleAbility | undefined {
  const role = ROLE_DEFINITIONS[roleType];
  return role?.abilities.find(a => a.name === abilityName);
}

