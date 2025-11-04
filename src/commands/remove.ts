import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { economyAdminService } from '../modules/admin/services/economyAdminService';
import { permissionService } from '../modules/admin/services/permissionService';
import { auditLogger } from '../modules/admin/services/auditLogger';
import { UserAuditLogData } from '../modules/admin/types';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove coins from a user (Staff only)')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to remove coins from')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Amount of coins to remove')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const guildId = interaction.guildId!;
      const member = interaction.member;

      // Check if member exists (should always be true in guild)
      if (!member || typeof member.permissions === 'string') {
        await interaction.reply({
          content: '❌ Unable to verify permissions.',
          ephemeral: true,
        });
        return;
      }

      // Check staff permissions
      const permissionCheck = permissionService.hasStaffPermission(member as any, guildId);
      if (!permissionCheck.hasPermission) {
        await interaction.reply({
          content: `❌ ${permissionCheck.reason}`,
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const targetUser = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);

      // Execute the remove coins operation
      const result = await economyAdminService.removeCoins(
        targetUser.id,
        guildId,
        amount,
        interaction.user.id
      );

      if (!result.success) {
        await interaction.editReply({
          embeds: [createErrorEmbed('Failed to Remove Coins', result.error || 'An unknown error occurred')],
        });
        return;
      }

      // Create success embed
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('✅ Coins Removed Successfully')
        .setDescription(`Removed **${amount.toLocaleString()}** coins from ${targetUser}`)
        .addFields(
          {
            name: '💵 Balance Before',
            value: `${result.balanceBefore.toLocaleString()} coins`,
            inline: true,
          },
          {
            name: '💰 Balance After',
            value: `${result.balanceAfter.toLocaleString()} coins`,
            inline: true,
          },
          {
            name: '➖ Amount Removed',
            value: `${amount.toLocaleString()} coins`,
            inline: true,
          }
        )
        .setFooter({ text: `Staff: ${interaction.user.username}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Send audit log
      const auditData: UserAuditLogData = {
        actionType: 'user_remove_coins',
        staffUserId: interaction.user.id,
        staffUsername: interaction.user.username,
        targetUserId: targetUser.id,
        targetUsername: targetUser.username, // Use Discord username instead of database username
        amount,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
        guildId,
        timestamp: new Date(),
      };

      await auditLogger.logUserEconomyAction(interaction.client, auditData);

      logger.info(`Staff ${interaction.user.username} removed ${amount} coins from ${targetUser.username}`);
    } catch (error) {
      logger.error('Error in remove command:', error);
      await interaction.editReply({
        embeds: [createErrorEmbed('Error', 'An unexpected error occurred while removing coins.')],
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
