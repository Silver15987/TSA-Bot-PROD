import { Client, Guild } from 'discord.js';
import { database } from '../../../database/client';
import { factionManager } from './factionManager';
import { disbandManager } from './disbandManager';
import { factionAnnouncementService } from './factionAnnouncementService';
import logger from '../../../core/logger';

/**
 * Upkeep Manager
 * Handles daily upkeep processing for all factions
 */
export class UpkeepManager {
  /**
   * Process upkeep for all factions that are due
   */
  async processAllUpkeep(client: Client): Promise<void> {
    try {
      logger.info('Starting daily upkeep processing for all factions...');

      const now = new Date();

      // Find all factions where upkeep is due
      const factionsNeedingUpkeep = await database.factions.find({
        nextUpkeepDate: { $lte: now },
      }).toArray();

      logger.info(`Found ${factionsNeedingUpkeep.length} factions needing upkeep processing`);

      let processed = 0;
      let disbanded = 0;
      let errors = 0;

      for (const faction of factionsNeedingUpkeep) {
        try {
          const result = await this.processFactionUpkeep(faction.id, faction.guildId, client);

          if (result.success) {
            processed++;
          } else if (result.disbanded) {
            disbanded++;
          } else {
            errors++;
          }
        } catch (error) {
          logger.error(`Error processing upkeep for faction ${faction.id}:`, error);
          errors++;
        }
      }

      logger.info(
        `Upkeep processing complete: ${processed} processed, ${disbanded} disbanded, ${errors} errors`
      );
    } catch (error) {
      logger.error('Error in processAllUpkeep:', error);
    }
  }

  /**
   * Process upkeep for a single faction
   */
  async processFactionUpkeep(
    factionId: string,
    guildId: string,
    client: Client
  ): Promise<{ success: boolean; disbanded?: boolean; error?: string }> {
    try {
      // Get faction
      const faction = await factionManager.getFactionById(factionId, guildId);
      if (!faction) {
        logger.warn(`Faction ${factionId} not found during upkeep processing`);
        return {
          success: false,
          error: 'Faction not found',
        };
      }

      // Check if faction has sufficient funds for upkeep
      if (faction.treasury < faction.upkeepAmount) {
        // Insufficient funds - disband faction
        logger.info(
          `Faction ${faction.name} (${factionId}) has insufficient funds for upkeep. Disbanding...`
        );

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
          logger.error(`Guild ${guildId} not found, cannot disband faction ${factionId}`);
          return {
            success: false,
            error: 'Guild not found',
          };
        }

        const disbandResult = await disbandManager.disbandFaction(
          factionId,
          guildId,
          guild,
          'upkeep_failure'
        );

        if (disbandResult) {
          logger.info(`Faction ${faction.name} (${factionId}) disbanded due to insufficient upkeep funds`);
          return {
            success: true,
            disbanded: true,
          };
        } else {
          logger.error(`Failed to disband faction ${factionId} during upkeep`);
          return {
            success: false,
            error: 'Failed to disband faction',
          };
        }
      }

      // Deduct upkeep cost from treasury
      const updateResult = await database.factions.updateOne(
        { id: factionId, guildId },
        {
          $inc: { treasury: -faction.upkeepAmount },
          $set: {
            nextUpkeepDate: this.calculateNextUpkeepDate(),
            updatedAt: new Date(),
          },
        }
      );

      if (updateResult.modifiedCount === 0) {
        logger.warn(`Failed to update faction ${factionId} during upkeep processing`);
        return {
          success: false,
          error: 'Failed to update faction',
        };
      }

      const newBalance = faction.treasury - faction.upkeepAmount;

      logger.info(
        `Processed upkeep for faction ${faction.name} (${factionId}): -${faction.upkeepAmount} coins. New balance: ${newBalance} coins`
      );

      // Check if treasury is low (less than 3 days worth of upkeep)
      const daysRemaining = Math.floor(newBalance / faction.upkeepAmount);
      if (daysRemaining <= 3 && daysRemaining > 0) {
        await factionAnnouncementService.sendLowTreasuryWarning(
          client,
          faction.channelId,
          faction.roleId,
          newBalance,
          faction.upkeepAmount,
          daysRemaining
        );
      }

      return { success: true };
    } catch (error) {
      logger.error(`Error processing upkeep for faction ${factionId}:`, error);
      return {
        success: false,
        error: 'Unexpected error',
      };
    }
  }

  /**
   * Calculate next upkeep date (tomorrow at midnight UTC)
   */
  private calculateNextUpkeepDate(): Date {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow;
  }

  /**
   * Check for and process any missed upkeeps (e.g., bot was offline)
   * Should be called on bot startup
   */
  async checkMissedUpkeeps(client: Client): Promise<void> {
    try {
      logger.info('Checking for missed upkeeps...');

      const now = new Date();

      // Find all factions with overdue upkeeps
      const overdueFactionsCount = await database.factions.countDocuments({
        nextUpkeepDate: { $lt: now },
      });

      if (overdueFactionsCount > 0) {
        logger.warn(`Found ${overdueFactionsCount} factions with overdue upkeeps. Processing now...`);
        await this.processAllUpkeep(client);
      } else {
        logger.info('No missed upkeeps found');
      }
    } catch (error) {
      logger.error('Error checking for missed upkeeps:', error);
    }
  }
}

export const upkeepManager = new UpkeepManager();
