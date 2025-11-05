import logger from '../../../core/logger';
import { roleConditionTracker } from '../services/roleConditionTracker';

/**
 * Transaction Monitor
 * Monitors transactions for role condition tracking (coins spent)
 */
export async function monitorTransaction(
  userId: string,
  guildId: string,
  amount: number,
  _transactionType: string
): Promise<void> {
  try {
    // Only track negative amounts (spending) for coins_spent condition
    if (amount < 0) {
      const spentAmount = Math.abs(amount);
      
      // Update role condition progress
      const result = await roleConditionTracker.updateProgress(
        userId,
        guildId,
        'coins_spent',
        spentAmount
      );

      if (result.roleUnlocked) {
        logger.info(`User ${userId} unlocked role ${result.roleUnlocked} via coins spent`);
      }
    }
  } catch (error) {
    logger.error(`Error monitoring transaction for role conditions:`, error);
    // Don't throw - transaction monitoring shouldn't break transactions
  }
}

