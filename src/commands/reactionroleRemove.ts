import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageReaction,
} from 'discord.js';
import { database } from '../database/client';
import { configManager } from '../core/configManager';
import logger from '../core/logger';
import { roleSystemGuard } from '../modules/roles/utils/roleSystemGuard';

export default {
  data: new SlashCommandBuilder()
    .setName('reactionrole-remove')
    .setDescription('Remove a reaction role configuration and its reaction (Admin/staff)')
    .addStringOption(option =>
      option
        .setName('messageid')
        .setDescription('The ID of the message with the reaction role')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('channelid')
        .setDescription('The channel ID where the message is located (defaults to current channel)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('emoji')
        .setDescription('Emoji to remove (default: ✅)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!interaction.guildId || !interaction.guild) {
        await interaction.reply({
          content: '❌ This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      // Check if role system is enabled
      if (!(await roleSystemGuard.isEnabled(interaction.guildId!))) {
        await interaction.editReply({
          content: roleSystemGuard.getDisabledMessage(),
        });
        return;
      }

      const guildId = interaction.guildId;
      const messageId = interaction.options.getString('messageid', true);
      const channelId = interaction.options.getString('channelid') || interaction.channelId;
      const emojiInput = interaction.options.getString('emoji') || '✅';

      // Permission: admin or staff role
      const config = configManager.getConfig(guildId);
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) {
        await interaction.editReply({ content: '❌ Could not verify your permissions.' });
        return;
      }
      const hasPermission =
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        (config.admin?.staffRoleIds?.some(roleId => member.roles.cache.has(roleId)) ?? false);
      if (!hasPermission) {
        await interaction.editReply({
          content: '❌ You need administrator permissions or a staff role to use this command.',
        });
        return;
      }

      // Fetch channel & message
      const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        await interaction.editReply({
          content: '❌ Could not find that channel or it is not a text channel.',
        });
        return;
      }

      let message;
      try {
        message = await (channel as any).messages.fetch(messageId);
      } catch (error) {
        await interaction.editReply({
          content: '❌ Could not find message with that ID in the specified channel.',
        });
        return;
      }

      // Remove DB entry
      const deleteResult = await database.reactionRoles.deleteOne({
        messageId,
        emoji: emojiInput,
        guildId,
      });

      // Remove reaction (best effort)
      try {
        const reaction =
          message.reactions.resolve(emojiInput) ||
          message.reactions.cache.find(
            (r: MessageReaction) => r.emoji.id === emojiInput || r.emoji.name === emojiInput
          );
        if (reaction) {
          await reaction.remove();
        }
      } catch (error) {
        logger.warn(`Failed to remove reaction ${emojiInput} on message ${messageId}:`, error);
      }

      const removed = deleteResult.deletedCount || 0;
      await interaction.editReply({
        content: `✅ Removal complete. DB entries removed: ${removed}. Reaction cleaned (best effort).`,
      });

      logger.info(
        `Reaction role removal: message ${messageId}, emoji ${emojiInput}, guild ${guildId}, removed ${removed}`
      );
    } catch (error) {
      logger.error('Error in reactionrole-remove command:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ An error occurred while removing the reaction role.',
        });
      } else {
        await interaction.reply({
          content: '❌ An error occurred while removing the reaction role.',
          ephemeral: true,
        });
      }
    }
  },
};

