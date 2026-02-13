/**
 * Toggle Role System On/Off
 * Usage: npm run toggle-roles <guildId> <enabled>
 * Example:
 *   npm run toggle-roles 123456789 true   (enable roles)
 *   npm run toggle-roles 123456789 false  (disable roles)
 */

import { database } from '../src/database/client';
import { configManager } from '../src/core/configManager';
import logger from '../src/core/logger';

async function toggleRoles(guildId: string, enabled: boolean): Promise<void> {
  try {
    const status = enabled ? 'ENABLED' : 'DISABLED';
    logger.info(`Setting role system to ${status} for guild ${guildId}`);
    
    await database.connect();
    
    const result = await database.serverConfigs.updateOne(
      { guildId },
      {
        $set: {
          'roles.enabled': enabled,
          updatedAt: new Date(),
          updatedBy: 'toggle-roles-script',
        },
        $inc: { version: 1 },
      }
    );
    
    if (result.matchedCount === 0) {
      throw new Error(`Config not found for guild ${guildId}`);
    }
    
    // Clear config cache to force reload
    configManager.clearCache();
    
    // Clear roleSystemGuard cache
    const { roleSystemGuard } = await import('../src/modules/roles/utils/roleSystemGuard');
    roleSystemGuard.clearCache();
    
    logger.info(`✅ Role system ${status} for guild ${guildId}`);
    
    // Verify the change
    await configManager.loadConfig(guildId);
    const config = configManager.getConfig(guildId);
    const rolesEnabled = config.roles?.enabled !== false;
    
    if (rolesEnabled === enabled) {
      logger.info(`✅ Verified: Role system is now ${rolesEnabled ? 'ENABLED' : 'DISABLED'}`);
    } else {
      logger.warn(`⚠️  Warning: Config shows roles.enabled = ${config.roles?.enabled}, expected ${enabled}`);
    }
    
    if (!enabled) {
      logger.info('⚠️  Note: Scheduler will skip on next run. Consider restarting bot for full effect.');
    }
    
  } catch (error) {
    logger.error('Failed to toggle role system:', error);
    throw error;
  } finally {
    await database.disconnect();
  }
}

// CLI parsing
const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: npm run toggle-roles <guildId> <enabled>');
  console.error('');
  console.error('Examples:');
  console.error('  npm run toggle-roles 123456789 true   (enable roles)');
  console.error('  npm run toggle-roles 123456789 false  (disable roles)');
  process.exit(1);
}

const guildId = args[0];
const enabled = args[1] === 'true';

if (args[1] !== 'true' && args[1] !== 'false') {
  console.error('Error: enabled must be "true" or "false"');
  process.exit(1);
}

toggleRoles(guildId, enabled)
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
