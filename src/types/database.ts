/**
 * Database schema types
 */

/**
 * User Document Schema
 */
export interface UserDocument {
  id: string; // Discord user ID
  guildId: string; // Discord server ID
  username: string;
  discriminator: string;

  // VC Tracking
  totalVcTime: number; // Total milliseconds in VC (all-time)
  dailyVcTime: number; // Resets daily
  weeklyVcTime: number; // Resets weekly
  monthlyVcTime: number; // Resets monthly

  // Economy
  coins: number; // Current balance
  totalCoinsEarned: number; // Lifetime earnings
  dailyCoinsEarned: number; // Resets daily
  weeklyCoinsEarned: number; // Resets weekly
  monthlyCoinsEarned: number; // Resets monthly

  // Streak System
  lastActiveDate: Date;
  currentStreak: number; // Days
  longestStreak: number;

  // Faction
  currentFaction: string | null; // Faction ID
  factionJoinDate: Date | null;
  factionCoinsDeposited: number; // Total deposited to faction
  factionVcTime: number; // Time spent in current faction's VC (resets on leave)
  lifetimeFactionVcTime: number; // Total faction VC time across all factions

  // Gambling Statistics
  gamblingStats?: {
    gamesPlayed: number;
    totalWagered: number;
    totalWon: number;
    biggestWin: number;
    biggestLoss: number;
    coinflipGames: number;
    coinflipWins: number;
    slotsGames: number;
    slotsWins: number;
  };

  // Quest & War Statistics
  questsCompleted?: number;
  warsParticipated?: number;

  // Statistics for leaderboard
  lastDailyReset: Date;
  lastWeeklyReset: Date;
  lastMonthlyReset: Date;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Faction Ledger Entry Schema
 * Tracks individual deposit/withdrawal transactions for a faction
 */
export interface FactionLedgerEntry {
  id: string;
  userId: string;
  username: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  balanceAfter: number; // Faction treasury balance after this transaction
  createdAt: Date;
}

/**
 * Faction Document Schema
 */
export interface FactionDocument {
  id: string; // Unique faction ID
  guildId: string; // Discord server ID
  name: string; // Faction name (unique per server)

  // Discord Resources
  roleId: string; // Discord role ID
  channelId: string; // Discord voice channel ID

  // Membership
  ownerId: string; // User ID of faction owner
  officers: string[]; // User IDs with elevated permissions
  members: string[]; // All member user IDs

  // Economy
  treasury: number; // Current faction bank balance
  totalDeposited: number; // Lifetime deposits
  totalWithdrawn: number; // Lifetime withdrawals

  // Upkeep
  nextUpkeepDate: Date; // When next payment is due
  upkeepAmount: number; // Daily cost

  // Statistics
  totalVcTime: number; // Combined VC time of all members
  level: number; // Faction level (future: unlock perks)
  totalFactionVcTime: number; // Total time spent in faction VC specifically
  totalMessages: number; // Total messages in faction VC text channel

  // XP & Leveling System
  xp: number; // Current faction XP
  pendingVcXp: number; // Accumulated VC time (ms) pending XP conversion (batched updates)
  membersWhoGaveXp: string[]; // User IDs who have already given XP on join (prevents rejoins from giving XP)

  // Ledger
  ledger: FactionLedgerEntry[]; // Deposit/withdrawal transaction history (limited to last 100 entries)

  // Quest & War stats
  dailyQuestsCompleted: number;
  weeklyQuestsCompleted: number;
  warVictories: number;
  warLosses: number;
  warDraws: number;

  // Status tracking
  disbanded: boolean;
  disbandedAt: Date | null;
  disbandedReason: 'manual' | 'upkeep_failure' | null;

  // Historical member tracking
  totalMembersEver: number; // All-time unique member count
  peakMemberCount: number; // Highest concurrent member count
  memberHistory: Array<{
    userId: string;
    username: string;
    joinedAt: Date;
    leftAt: Date | null; // null if still member
    totalVcTimeWhileMember: number; // VC time in faction VC while member
    totalMessagesWhileMember: number; // Messages in faction channel while member
  }>;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Quest Document Schema
 */
export interface QuestDocument {
  id: string;
  factionId: string | null; // null if template
  guildId: string;

  // Quest details
  type: 'collective_vc_time' | 'treasury_deposit' | 'member_participation';
  name: string; // Quest title
  description: string;
  difficulty: 'easy' | 'medium' | 'hard'; // Based on faction size

  // Goals
  goal: number; // Target value (scaled by difficulty)
  baseGoal: number; // Original goal from template (unscaled)
  currentProgress: number; // Current value

  // Timing
  durationHours: number; // How long to complete after acceptance
  acceptanceWindowHours: number; // How long to accept (default 3)

  // Rewards
  treasuryReward: number; // Coins to faction treasury
  questXp: number; // XP awarded to faction on completion (default: 500)
  topContributorRewards: {
    first: number;
    second: number;
    third: number;
  };
  participationReward: number; // Everyone else who participated
  bonusEffect: string | null; // 'coin_multiplier_2x_24h', 'upkeep_forgiven_today', null

  // Status & Lifecycle
  status: 'template' | 'offered' | 'active' | 'completed' | 'failed' | 'rejected' | 'expired';
  isTemplate: boolean; // True for quest templates in pool

  // Timestamps
  createdAt: Date;
  offeredAt: Date | null; // When sent to faction
  acceptanceDeadline: Date | null; // 3 hours after offered
  acceptedAt: Date | null; // When faction accepted
  questDeadline: Date | null; // acceptedAt + durationHours
  completedAt: Date | null;

  // Progress tracking
  contributorStats: {
    [userId: string]: {
      userId: string;
      contribution: number; // VC time (ms) or coins deposited
      rank?: number; // Set when quest completes
      reward?: number; // Calculated reward
    };
  };

  // Metadata
  createdBy: string; // Admin who created template
  updatedAt: Date;
}

/**
 * Quest Cooldown Document Schema
 */
export interface QuestCooldownDocument {
  factionId: string;
  guildId: string;
  cooldownEndsAt: Date; // When faction can receive next quest
  lastRejectedQuestId: string | null;
  rejectionCount: number; // Historical tracking
  createdAt: Date;
  updatedAt: Date;
}

/**
 * War Document Schema
 */
export interface WarDocument {
  id: string;
  guildId: string;

  // War configuration
  type: 'vctime' | 'treasury' | 'koth' | 'tournament';
  durationHours: number;
  entryFee: number;
  prizePool: number;

  // Participants
  registeredFactions: string[];
  factionStats: {
    [factionId: string]: {
      factionId: string;
      factionName: string;
      progress: number;
      rank: number;
    };
  };

  // Status
  status: 'registration' | 'active' | 'completed' | 'cancelled';
  registrationEndsAt: Date;
  startsAt: Date;
  endsAt: Date;

  // Results
  winnerFactionId: string | null;
  finalStandings: any[];

  // Metadata
  createdBy: string;
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * Transaction Document Schema
 */
export interface TransactionDocument {
  id: string;
  userId: string;

  type: 'coinflip' | 'slots' | 'vctime_earn' | 'faction_deposit' | 'faction_withdraw' | 'admin_add' | 'admin_remove' | 'quest_reward' | 'war_reward';
  amount: number; // Positive = gain, Negative = loss
  balanceAfter: number;

  metadata: {
    [key: string]: any;
  };

  createdAt: Date;
}

/**
 * Server Configuration Document Schema
 */
export interface ServerConfigDocument {
  guildId: string;

  // VC Tracking Configuration
  vcTracking: {
    enabled: boolean;
    trackedCategoryIds: string[]; // Support multiple tracked categories
    coinsPerSecond: number;
    sessionTTL: number;
    syncInterval: number;
  };

  // Economy Configuration
  economy: {
    startingCoins: number;
  };

  // Faction Configuration
  factions: {
    enabled: boolean;
    factionCategoryId: string;
    maxFactionsPerServer: number;
    createCost: number;
    minInitialDeposit: number;
    dailyUpkeepCost: number;
    maxMembersPerFaction: number;
    welcomeMessages: string[]; // Custom welcome messages for new members
    announcementChannelId: string; // Channel for faction announcements
  };

  // Gambling Configuration
  gambling: {
    enabled: boolean;
    coinflip: {
      minBet: number;
      maxBet: number;
      houseEdge: number;
    };
    slots: {
      minBet: number;
      maxBet: number;
      houseEdge: number;
    };
  };

  // Admin Configuration
  admin: {
    staffRoleIds: string[]; // Roles that can use admin commands
    auditLogChannelId: string; // Channel for audit logs
    betaRoleIds?: string[]; // Roles that can use bot during beta testing
  };

  // Quest Configuration
  quests: {
    enabled: boolean;
    acceptanceWindowHours: number; // Default 3
    cooldownHours: number; // Default 3
    autoAssignEnabled: boolean; // Auto-assign quests to factions
    autoAssignIntervalHours: number; // Check interval for auto-assignment
    difficultyScaling: {
      easy: {
        maxMembers: number;
        vcTimeMultiplier: number;
        coinsMultiplier: number;
      };
      medium: {
        maxMembers: number;
        vcTimeMultiplier: number;
        coinsMultiplier: number;
      };
      hard: {
        maxMembers: number;
        vcTimeMultiplier: number;
        coinsMultiplier: number;
      };
    };
  };

  // Metadata
  updatedAt: Date;
  updatedBy: string;
  version: number;
}

/**
 * Reaction Role Document Schema
 */
export interface ReactionRoleDocument {
  messageId: string; // Discord message ID
  channelId: string; // Discord channel ID
  guildId: string; // Discord server ID
  roleId: string; // Discord role ID to assign
  emoji: string; // Emoji to react with (unicode or custom emoji ID)
  createdAt: Date;
  createdBy: string; // User ID who created the reaction role
}

/**
 * VC Activity Document Schema
 * Stores individual VC session records for historical tracking
 */
export interface VCActivityDocument {
  id: string; // session_userId_timestamp (e.g., "session_123456789_1698765432000")
  userId: string; // Discord user ID
  guildId: string; // Discord guild ID

  // Session details
  startTime: Date; // When session started
  endTime: Date; // When session ended
  duration: number; // Duration in milliseconds (for easy aggregation)

  // Context
  channelId: string; // Which VC channel
  channelType: 'faction' | 'general'; // Quick classification
  factionId: string | null; // Faction ID if in faction VC, null otherwise

  // Earnings
  coinsEarned: number; // Coins earned this session

  // Metadata
  date: Date; // Date normalized to 00:00:00 UTC (for daily aggregation)
  createdAt: Date; // Record creation timestamp (for TTL index)
}
