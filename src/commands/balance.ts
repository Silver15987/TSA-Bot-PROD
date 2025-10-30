import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { database } from '../database/client';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your coin balance and stats')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to check balance for (default: yourself)')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const targetUser = interaction.options.getUser('user') || interaction.user;
      const guildId = interaction.guildId!;

      const userData = await database.users.findOne({
        id: targetUser.id,
        guildId,
      });

      if (!userData) {
        await interaction.editReply({
          content: `❌ ${targetUser.id === interaction.user.id ? 'You are' : 'This user is'} not registered yet!\n` +
            `Use \`/register\` to get started.`,
        });
        return;
      }

      const vcHours = Math.floor(userData.totalVcTime / 3600);
      const vcMinutes = Math.floor((userData.totalVcTime % 3600) / 60);

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`${targetUser.username}'s Profile`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          {
            name: '💰 Coins',
            value: `${userData.coins.toLocaleString()}`,
            inline: true,
          },
          {
            name: '🎤 VC Time',
            value: `${vcHours}h ${vcMinutes}m`,
            inline: true,
          },
          {
            name: '🔥 Current Streak',
            value: `${userData.currentStreak} days`,
            inline: true,
          },
          {
            name: '🏆 Longest Streak',
            value: `${userData.longestStreak} days`,
            inline: true,
          },
          {
            name: '🎯 Quests Completed',
            value: `${userData.questsCompleted}`,
            inline: true,
          },
          {
            name: '⚔️ Wars Participated',
            value: `${userData.warsParticipated}`,
            inline: true,
          }
        )
        .setFooter({ text: `Member since ${(userData.createdAt || userData.updatedAt || new Date()).toLocaleDateString()}` })
        .setTimestamp();

      if (userData.currentFaction) {
        const faction = await database.factions.findOne({ id: userData.currentFaction });
        if (faction) {
          embed.addFields({
            name: '🏴 Current Faction',
            value: faction.name,
            inline: false,
          });
        }
      }

      if (userData.gamblingStats && userData.gamblingStats.gamesPlayed > 0) {
        const profit = userData.gamblingStats.totalWon - userData.gamblingStats.totalWagered;
        embed.addFields({
          name: '🎲 Gambling Stats',
          value: `Games: ${userData.gamblingStats.gamesPlayed} | ` +
            `Wagered: ${userData.gamblingStats.totalWagered.toLocaleString()} | ` +
            `Profit: ${profit >= 0 ? '+' : ''}${profit.toLocaleString()}`,
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error in balance command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while fetching balance. Please try again.',
      });
    }
  },
};
