import { Events, Interaction, PermissionFlagsBits } from 'discord.js';
import logger from '../core/logger';
import { BotClient } from '../core/client';
import { permissionService } from '../modules/admin/services/permissionService';

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

      // Check beta permissions (unless it's a config command or user is admin)
      if (interaction.guildId && interaction.guild && interaction.member) {
        const member = interaction.member;
        const guildId = interaction.guildId;

        // Skip beta check for config command (admins need to set up beta roles)
        // Also skip for admins (they bypass beta restrictions)
        const isAdmin = member.permissions &&
          (typeof member.permissions === 'string'
            ? BigInt(member.permissions) & BigInt(PermissionFlagsBits.Administrator)
            : member.permissions.has(PermissionFlagsBits.Administrator));

        if (!isAdmin && interaction.commandName !== 'config') {
          const betaCheck = permissionService.hasBetaPermission(
            interaction.guild.members.cache.get(interaction.user.id)!,
            guildId
          );

          if (!betaCheck.hasPermission) {
            await interaction.reply({
              content: `❌ ${betaCheck.reason}`,
              ephemeral: true,
            });
            logger.info(`Beta permission denied for ${interaction.user.tag} in ${interaction.guild.name}`);
            return;
          }
        }
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
