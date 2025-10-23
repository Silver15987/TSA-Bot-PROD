import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { database } from '../database/client';
import { configManager } from '../core/configManager';
import { slotsService } from '../modules/gambling/services/slotsService';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Play the slot machine')
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Amount of coins to bet')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const amount = interaction.options.getInteger('amount', true);
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
      const validation = slotsService.validateBet(
        amount,
        userData.coins,
        config.gambling.slots.minBet,
        config.gambling.slots.maxBet
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

      // Play slots
      const result = await slotsService.playSlots(
        userId,
        guildId,
        amount,
        config.gambling.slots.houseEdge
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
        .setColor(result.won ? 0xf39c12 : 0xe74c3c)
        .setTitle('🎰 Slot Machine')
        .setFooter({ text: `${interaction.user.username}` })
        .setTimestamp();

      // Build description
      let description = `╔═══════════════╗\n`;
      description += `║  ${result.symbols.join(' │ ')}  ║\n`;
      description += `╚═══════════════╝\n\n`;

      if (result.won) {
        if (result.winType === 'jackpot') {
          description += `🎉 **JACKPOT!!!** 🎉\n`;
          description += `💰 You won **${result.winnings.toLocaleString()}** coins! (${result.multiplier}x)\n\n`;
        } else if (result.winType === 'three_of_a_kind') {
          description += `⭐ **Three of a Kind!** ⭐\n`;
          description += `💰 You won **${result.winnings.toLocaleString()}** coins! (${result.multiplier}x)\n\n`;
        } else if (result.winType === 'two_of_a_kind') {
          description += `✨ **Two of a Kind!** ✨\n`;
          description += `💰 You won **${result.winnings.toLocaleString()}** coins! (${result.multiplier}x)\n\n`;
        }
      } else {
        description += `😔 No match! Better luck next time.\n`;
        description += `💸 You lost **${amount.toLocaleString()}** coins.\n\n`;
      }

      description += `**Bet Amount:** ${amount.toLocaleString()} coins\n`;
      description += `**New Balance:** ${result.newBalance.toLocaleString()} coins`;

      embed.setDescription(description);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.error('Error in slots command:', error);
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
