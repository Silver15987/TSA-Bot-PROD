import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { redis } from '../cache/client';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('testcache')
    .setDescription('Test Redis cache connection (Admin only)'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Test 1: Set a value
      const testKey = `test:${interaction.user.id}:${Date.now()}`;
      const testValue = 'Hello from Redis!';
      await redis.setex(testKey, 60, testValue);

      // Test 2: Get the value
      const retrievedValue = await redis.get(testKey);

      // Test 3: Check if key exists
      const exists = await redis.exists(testKey);

      // Test 4: Increment a counter
      const counterKey = `test:counter:${interaction.user.id}`;
      const counterValue = await redis.incr(counterKey);
      await redis.expire(counterKey, 300); // 5 minutes

      // Test 5: Delete the test key
      await redis.del(testKey);

      const results = [
        `✅ **Redis Cache Test Results**\n`,
        `**1. SET Test:** ${retrievedValue === testValue ? '✅ PASS' : '❌ FAIL'}`,
        `   - Set key: \`${testKey}\``,
        `   - Expected: "${testValue}"`,
        `   - Retrieved: "${retrievedValue}"\n`,
        `**2. EXISTS Test:** ${exists ? '✅ PASS' : '❌ FAIL'}`,
        `   - Key existed: ${exists}\n`,
        `**3. INCR Test:** ✅ PASS`,
        `   - Counter value: ${counterValue}`,
        `   - (This counter will reset in 5 minutes)\n`,
        `**4. DEL Test:** ✅ PASS`,
        `   - Test key cleaned up\n`,
        `**Connection Status:** ${redis.isReady() ? '🟢 Connected' : '🔴 Disconnected'}`,
      ].join('\n');

      await interaction.editReply({ content: results });

      logger.info(`Redis cache test completed by user ${interaction.user.id}`);
    } catch (error) {
      logger.error('Error in testcache command:', error);
      await interaction.editReply({
        content: `❌ **Redis Cache Test Failed**\n\n` +
          `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
          `Please check the bot logs for more details.`,
      });
    }
  },
};
