import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { database } from '../database/client';
import { configManager } from '../core/configManager';
import { coinflipService } from '../modules/gambling/services/coinflipService';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin and bet on the outcome')
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Amount of coins to bet')
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(option =>
      option
        .setName('choice')
        .setDescription('Heads or Tails?')
        .setRequired(true)
        .addChoices(
          { name: 'Heads', value: 'heads' },
          { name: 'Tails', value: 'tails' }
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const amount = interaction.options.getInteger('amount', true);
      const choice = interaction.options.getString('choice', true) as 'heads' | 'tails';
      const userId = interaction.user.id;
      const guildId = interaction.guildId!;

      // Get config
      const config = configManager.getConfig(guildId);

      // Check if gambling is enabled
      if (!config.gambling.enabled) {
        await interaction.editReply({
          embeds: [createErrorEmbed(
            'Gambling Disabled',
            'Gambling is currently disabled on this server.'
          )],
        });
        return;
      }

      // Get user data
      const userData = await database.users.findOne({ id: userId, guildId });
      if (!userData) {
        await interaction.editReply({
          embeds: [createErrorEmbed(
            'Not Registered',
            'You need to register first! Use `/register` to get started.'
          )],
        });
        return;
      }

      // Validate bet
      const validation = coinflipService.validateBet(
        amount,
        userData.coins,
        config.gambling.coinflip.minBet,
        config.gambling.coinflip.maxBet
      );

      if (!validation.valid) {
        await interaction.editReply({
          embeds: [createErrorEmbed(
            'Invalid Bet',
            validation.error!
          )],
        });
        return;
      }

      // Play coinflip
      const result = await coinflipService.playCoinflip(
        userId,
        guildId,
        amount,
        choice,
        config.gambling.coinflip.houseEdge
      );

      if (!result) {
        await interaction.editReply({
          embeds: [createErrorEmbed(
            'Game Error',
            'An error occurred while processing your bet. Please try again.'
          )],
        });
        return;
      }

      // Create result embed
      const embed = new EmbedBuilder()
        .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
        .setTitle(`🪙 Coinflip ${result.won ? 'Win!' : 'Loss'}`)
        .setDescription(
          `**Your Choice:** ${capitalizeFirst(result.userChoice)}\n` +
          `**Result:** ${capitalizeFirst(result.result)}\n\n` +
          `**Bet Amount:** ${amount.toLocaleString()} coins\n` +
          `**${result.won ? 'Winnings' : 'Loss'}:** ${amount.toLocaleString()} coins\n` +
          `**New Balance:** ${result.newBalance.toLocaleString()} coins`
        )
        .setFooter({ text: `${interaction.user.username}` })
        .setTimestamp();

      // Add coin animation
      const coinAnimation = result.result === 'heads' ? '🔵' : '🔴';
      embed.setDescription(`${coinAnimation} The coin landed on **${capitalizeFirst(result.result)}**!\n\n` + embed.data.description);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.error('Error in coinflip command:', error);
      await interaction.editReply({
        embeds: [createErrorEmbed(
          'Error',
          'An unexpected error occurred. Please try again.'
        )],
      });
    }
  },
};

function createErrorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(0xe74c3c);
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
