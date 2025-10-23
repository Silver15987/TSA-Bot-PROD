import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { database } from '../database/client';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register yourself in the bot database'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const userId = interaction.user.id;
      const guildId = interaction.guildId!;

      // Check if user already exists
      const existingUser = await database.users.findOne({ id: userId, guildId });

      if (existingUser) {
        await interaction.editReply({
          content: `✅ You're already registered!\n` +
            `**Coins:** ${existingUser.coins}\n` +
            `**Total VC Time:** ${Math.floor(existingUser.totalVcTime / 60)} minutes\n` +
            `**Current Streak:** ${existingUser.currentStreak} days`,
        });
        return;
      }

      // Create new user
      const newUser = {
        id: userId,
        guildId,
        username: interaction.user.username,
        discriminator: interaction.user.discriminator,
        totalVcTime: 0,
        coins: 1000, // Starting bonus
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        currentFaction: null,
        factionHistory: [],
        questsCompleted: 0,
        warsParticipated: 0,
        gamblingStats: {
          totalWagered: 0,
          totalWon: 0,
          gamesPlayed: 0,
        },
      };

      await database.users.insertOne(newUser);

      logger.info(`New user registered: ${userId} in guild ${guildId}`);

      await interaction.editReply({
        content: `🎉 **Welcome to the server!**\n\n` +
          `You've been registered and received **1000 coins** as a starting bonus!\n\n` +
          `Use \`/balance\` to check your coins.\n` +
          `Join a voice channel to start earning more coins!`,
      });
    } catch (error) {
      logger.error('Error in register command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while registering. Please try again.',
      });
    }
  },
};
