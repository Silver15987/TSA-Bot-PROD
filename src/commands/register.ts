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
        dailyVcTime: 0,
        weeklyVcTime: 0,
        monthlyVcTime: 0,
        coins: 1000, // Starting bonus
        totalCoinsEarned: 1000,
        dailyCoinsEarned: 0,
        weeklyCoinsEarned: 0,
        monthlyCoinsEarned: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: new Date(),
        currentFaction: null,
        factionJoinDate: null,
        factionCoinsDeposited: 0,
        factionVcTime: 0,
        lifetimeFactionVcTime: 0,
        gamblingStats: {
          gamesPlayed: 0,
          totalWagered: 0,
          totalWon: 0,
          biggestWin: 0,
          biggestLoss: 0,
          coinflipGames: 0,
          coinflipWins: 0,
          slotsGames: 0,
          slotsWins: 0,
        },
        questsCompleted: 0,
        warsParticipated: 0,
        statuses: [],
        items: [],
        multiplierEnabled: true,
        lastDailyReset: new Date(),
        lastWeeklyReset: new Date(),
        lastMonthlyReset: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
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
