import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { database } from '../database/client';
import { configManager } from '../core/configManager';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Set up reaction roles for a message')
    .addStringOption(option =>
      option
        .setName('messageid')
        .setDescription('The ID of the message to add reactions to')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('The role to assign when users react')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const messageId = interaction.options.getString('messageid', true);
      const role = interaction.options.getRole('role', true);
      const guildId = interaction.guildId!;
      const channelId = interaction.channelId;

      // Check if user has admin permissions
      const config = configManager.getConfig(guildId);
      const member = interaction.guild!.members.cache.get(interaction.user.id);

      if (!member) {
        await interaction.editReply({
          content: '❌ Could not verify your permissions.',
        });
        return;
      }

      // Check if user is admin or has staff role
      const hasPermission =
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        (config.admin?.staffRoleIds?.some(roleId => member.roles.cache.has(roleId)) ?? false);

      if (!hasPermission) {
        await interaction.editReply({
          content: '❌ You need administrator permissions or a staff role to use this command.',
        });
        return;
      }

      // Validate role
      if (role.managed) {
        await interaction.editReply({
          content: '❌ Cannot assign managed roles (bot roles, boosts, etc.).',
        });
        return;
      }

      // Check bot's highest role position
      const botMember = interaction.guild!.members.cache.get(interaction.client.user!.id);
      if (!botMember) {
        await interaction.editReply({
          content: '❌ Could not find bot member in guild.',
        });
        return;
      }

      const botHighestRole = botMember.roles.highest;
      if (role.position >= botHighestRole.position) {
        await interaction.editReply({
          content: `❌ I cannot assign this role because it's higher than or equal to my highest role (${botHighestRole.name}).`,
        });
        return;
      }

      // Try to fetch the message
      let message;
      try {
        const channel = await interaction.client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
          await interaction.editReply({
            content: '❌ This command can only be used in text channels.',
          });
          return;
        }

        message = await channel.messages.fetch(messageId);
      } catch (error) {
        await interaction.editReply({
          content: '❌ Could not find message with that ID. Make sure the message is in this channel.',
        });
        return;
      }

      // Use green check emoji (✅)
      const emoji = '✅';

      // Check if reaction role already exists for this message and emoji
      const existingReactionRole = await database.reactionRoles.findOne({
        messageId,
        emoji,
      });

      if (existingReactionRole) {
        await interaction.editReply({
          content: `❌ A reaction role with ${emoji} already exists on this message.`,
        });
        return;
      }

      // Add the reaction to the message
      try {
        await message.react(emoji);
      } catch (error) {
        logger.error('Failed to add reaction to message:', error);
        await interaction.editReply({
          content: '❌ Failed to add reaction to message. Make sure I have permission to add reactions.',
        });
        return;
      }

      // Store in database
      await database.reactionRoles.insertOne({
        messageId,
        channelId,
        guildId,
        roleId: role.id,
        emoji,
        createdAt: new Date(),
        createdBy: interaction.user.id,
      });

      await interaction.editReply({
        content: `✅ Reaction role set up successfully!\n\n` +
          `**Message:** ${messageId}\n` +
          `**Role:** ${role.name}\n` +
          `**Emoji:** ${emoji}\n\n` +
          `Users can now react with ${emoji} to get the ${role.name} role.`,
      });

      logger.info(
        `Reaction role created: message ${messageId}, role ${role.id}, emoji ${emoji} by ${interaction.user.id} in guild ${guildId}`
      );
    } catch (error) {
      logger.error('Error in reactionrole command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while setting up the reaction role. Please try again.',
      });
    }
  },
};
