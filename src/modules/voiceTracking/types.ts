/**
 * Voice Tracking Module Types
 */

export interface VCSession {
  userId: string;
  guildId: string;
  channelId: string;
  joinedAt: number; // Used for incremental save calculations
  sessionStartTime: number; // Original session start timestamp (never changes, used for /vcstats)
  factionId?: string; // Optional: ID of faction if in faction VC
  transferred?: boolean; // Flag indicating if user was moved between VCs
  oldChannelId?: string; // Previous channel ID if transferred
}

export interface SessionDuration {
  durationMs: number;
  durationSeconds: number;
  durationMinutes: number;
  durationHours: number;
}

export interface VCStats {
  totalVcTime: number;
  dailyVcTime: number;
  weeklyVcTime: number;
  monthlyVcTime: number;
  totalCoinsEarned: number;
  currentStreak: number;
  longestStreak: number;
  isCurrentlyInVC: boolean;
  currentSessionDuration?: number;
  currentSessionCoins?: number;
}
