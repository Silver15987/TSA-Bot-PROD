import { Events, Interaction } from 'discord.js';
import logger from '../core/logger';
import { BotClient } from '../core/client';

export default {
  name: Events.InteractionCreate,
  async execute(interaction: Interaction) {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      const client = interaction.client as BotClient;
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        logger.warn(`No command found for: ${interaction.commandName}`);
        return;
      }

      try {
        logger.info(
          `Executing command: ${interaction.commandName} by ${interaction.user.tag} in ${interaction.guild?.name || 'DM'}`
        );

        await command.execute(interaction);
      } catch (error) {
        logger.error(`Error executing command ${interaction.commandName}:`, error);

        const errorMessage = {
          content: '❌ There was an error executing this command!',
          ephemeral: true,
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      }
    }

    // Handle button interactions
    if (interaction.isButton()) {
      logger.debug(`Button interaction: ${interaction.customId}`);
      // Button handlers will be added here
    }

    // Handle select menu interactions
    if (interaction.isStringSelectMenu()) {
      logger.debug(`Select menu interaction: ${interaction.customId}`);
      // Select menu handlers will be added here
    }
  },
};
