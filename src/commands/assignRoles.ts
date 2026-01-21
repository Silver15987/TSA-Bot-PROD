import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Role,
} from 'discord.js';
import { database } from '../database/client';
import { permissionService } from '../modules/admin/services/permissionService';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('assign-roles')
    .setDescription('Set up balanced faction assignment via reaction roles (Event managers only)')
    .addStringOption(option =>
      option
        .setName('message_id')
        .setDescription('The ID of the message to add the reaction to')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('channel_id')
        .setDescription('The ID of the channel containing the message')
        .setRequired(true)
    )
    // Support 1–10 roles (role_1 required; role_2..role_10 optional)
    .addRoleOption(option =>
      option
        .setName('role_1')
        .setDescription('Faction role to assign (required)')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('role_2')
        .setDescription('Faction role to assign')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName('role_3')
        .setDescription('Faction role to assign')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName('role_4')
        .setDescription('Faction role to assign')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName('role_5')
        .setDescription('Faction role to assign')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName('role_6')
        .setDescription('Faction role to assign')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName('role_7')
        .setDescription('Faction role to assign')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName('role_8')
        .setDescription('Faction role to assign')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName('role_9')
        .setDescription('Faction role to assign')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName('role_10')
        .setDescription('Faction role to assign')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const guildId = interaction.guildId;
      if (!guildId || !interaction.guild) {
        await interaction.reply({
          content: '❌ This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const member = interaction.member;
      if (!member || typeof (member as any).permissions === 'string') {
        await interaction.reply({
          content: '❌ Unable to verify permissions.',
          ephemeral: true,
        });
        return;
      }

      const permissionCheck = permissionService.hasEventManagerPermission(member as any, guildId);
      if (!permissionCheck.hasPermission) {
        await interaction.reply({
          content: `❌ ${permissionCheck.reason}`,
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const messageId = interaction.options.getString('message_id', true);
      const channelId = interaction.options.getString('channel_id', true);

      const roleOptionNames = [
        'role_1',
        'role_2',
        'role_3',
        'role_4',
        'role_5',
        'role_6',
        'role_7',
        'role_8',
        'role_9',
        'role_10',
      ];

      const roles: Role[] = [];
      for (const optionName of roleOptionNames) {
        const required = optionName === 'role_1';
        const role = interaction.options.getRole(optionName as any, required) as Role | null;
        if (role) {
          roles.push(role);
        }
      }

      if (roles.length < 1) {
        await interaction.editReply({
          content: '❌ Please provide at least one role.',
        });
        return;
      }

      // Validate roles for bot hierarchy
      const botMember = await interaction.guild.members.fetch(interaction.client.user!.id);
      const botHighestRole = botMember.roles.highest;

      for (const role of roles) {
        if (role.managed) {
          await interaction.editReply({
            content: '❌ Cannot use managed roles (bot roles, boosts, etc.) for faction assignment.',
          });
          return;
        }

        if (role.position >= botHighestRole.position) {
          await interaction.editReply({
            content: `❌ I cannot assign the role ${role.name} because it's higher than or equal to my highest role (${botHighestRole.name}).`,
          });
          return;
        }
      }

      // Fetch the message
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

      const emoji = '✅';

      // Check if a reaction role already exists for this message and emoji
      const existing = await database.reactionRoles.findOne({
        messageId,
        emoji,
        guildId,
      });

      if (existing && !existing.roleIds) {
        await interaction.editReply({
          content: '❌ A simple reaction role with this emoji already exists on that message. Please remove it first or use a different message.',
        });
        return;
      }

      // Add the reaction to the message
      try {
        await message.react(emoji);
      } catch (error) {
        logger.error('Failed to add reaction to message for assign-roles:', error);
        await interaction.editReply({
          content: '❌ Failed to add reaction to message. Make sure I have permission to add reactions.',
        });
        return;
      }

      // Upsert balanced reaction role configuration
      await database.reactionRoles.updateOne(
        {
          messageId,
          emoji,
          guildId,
        },
        {
          $set: {
            messageId,
            channelId,
            guildId,
            roleId: roles[0].id, // primary role (kept for backward compatibility)
            roleIds: roles.map(r => r.id),
            emoji,
            createdBy: interaction.user.id,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );

      await interaction.editReply({
        content:
          '✅ Balanced faction assignment has been configured.\n\n' +
          `• Message: \`${messageId}\`\n` +
          `• Channel: <#${channelId}>\n` +
          `• Roles: ${roles.map(r => `<@&${r.id}>`).join(', ')}\n` +
          `• Emoji: ${emoji}\n\n` +
          'When a user without a faction reacts with ✅, they will be assigned to the faction role with the fewest members.',
      });

      logger.info(
        `Balanced assign-roles configured for message ${messageId} in guild ${guildId} by ${interaction.user.id} ` +
        `roles=${roles.map(r => r.id).join(',')}`
      );
    } catch (error) {
      logger.error('Error in assign-roles command:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ An unexpected error occurred while configuring balanced assignment.',
        });
      } else {
        await interaction.reply({
          content: '❌ An unexpected error occurred while configuring balanced assignment.',
          ephemeral: true,
        });
      }
    }
  },
};

