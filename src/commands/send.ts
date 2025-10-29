import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { database } from '../database/client';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('send')
    .setDescription('Send coins to another user')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to send coins to')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Amount of coins to send')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const sender = interaction.user;
      const receiver = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      const guildId = interaction.guildId!;

      // Validation: Can't send to yourself
      if (sender.id === receiver.id) {
        await interaction.editReply({
          content: '❌ You cannot send coins to yourself!',
        });
        return;
      }

      // Validation: Can't send to bots
      if (receiver.bot) {
        await interaction.editReply({
          content: '❌ You cannot send coins to bots!',
        });
        return;
      }

      // Validation: Amount must be positive
      if (amount <= 0) {
        await interaction.editReply({
          content: '❌ Amount must be greater than 0!',
        });
        return;
      }

      // Get sender's data
      const senderData = await database.users.findOne({
        id: sender.id,
        guildId,
      });

      if (!senderData) {
        await interaction.editReply({
          content: '❌ You are not registered yet! Use `/register` to get started.',
        });
        return;
      }

      // Check if sender has enough coins
      if (senderData.coins < amount) {
        await interaction.editReply({
          content: `❌ Insufficient balance! You have ${senderData.coins.toLocaleString()} coins but tried to send ${amount.toLocaleString()} coins.`,
        });
        return;
      }

      // Get receiver's data
      let receiverData = await database.users.findOne({
        id: receiver.id,
        guildId,
      });

      // If receiver is not registered, register them automatically
      if (!receiverData) {
        await interaction.editReply({
          content: `❌ ${receiver.username} is not registered yet! They need to use \`/register\` first.`,
        });
        return;
      }

      // Perform the transfer (deduct from sender, add to receiver)
      // Deduct from sender
      await database.users.updateOne(
        { id: sender.id, guildId },
        {
          $inc: { coins: -amount },
          $set: { updatedAt: new Date() },
        }
      );

      // Add to receiver
      await database.users.updateOne(
        { id: receiver.id, guildId },
        {
          $inc: { coins: amount },
          $set: { updatedAt: new Date() },
        }
      );

      // Success message
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('💸 Coin Transfer Successful')
        .setDescription(
          `${sender.username} sent **${amount.toLocaleString()}** coins to ${receiver.username}!`
        )
        .addFields(
          {
            name: '📤 Sender',
            value: `${sender.username}\nNew Balance: ${(senderData.coins - amount).toLocaleString()} coins`,
            inline: true,
          },
          {
            name: '📥 Receiver',
            value: `${receiver.username}\nNew Balance: ${(receiverData.coins + amount).toLocaleString()} coins`,
            inline: true,
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logger.info(
        `Coin transfer: ${sender.id} sent ${amount} coins to ${receiver.id} in guild ${guildId}`
      );
    } catch (error) {
      logger.error('Error in send command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while processing the transaction. Please try again.',
      });
    }
  },
};
