import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { factionAdminService } from '../modules/admin/services/factionAdminService';
import { permissionService } from '../modules/admin/services/permissionService';
import { auditLogger } from '../modules/admin/services/auditLogger';
import { FactionAuditLogData } from '../modules/admin/types';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('faction-add')
    .setDescription('Add coins to a faction treasury (Staff only)')
    .setDefaultMemberPermissions(0) // Hide from non-staff
    .addRoleOption(option =>
      option
        .setName('faction-role')
        .setDescription('The faction role')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Amount of coins to add')
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

      const factionRole = interaction.options.getRole('faction-role', true);
      const amount = interaction.options.getInteger('amount', true);

      // Get faction ID from role
      const factionId = await factionAdminService.getFactionByRoleId(factionRole.id, guildId);
      if (!factionId) {
        await interaction.editReply({
          embeds: [createErrorEmbed(
            'Faction Not Found',
            `The role ${factionRole} is not associated with any faction.`
          )],
        });
        return;
      }

      // Execute the add coins operation
      const result = await factionAdminService.addCoins(
        factionId,
        guildId,
        amount,
        interaction.user.id
      );

      if (!result.success) {
        await interaction.editReply({
          embeds: [createErrorEmbed('Failed to Add Coins', result.error || 'An unknown error occurred')],
        });
        return;
      }

      // Create success embed
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('✅ Faction Treasury Increased')
        .setDescription(`Added **${amount.toLocaleString()}** coins to **${result.factionName}** treasury`)
        .addFields(
          {
            name: '💵 Treasury Before',
            value: `${result.treasuryBefore.toLocaleString()} coins`,
            inline: true,
          },
          {
            name: '💰 Treasury After',
            value: `${result.treasuryAfter.toLocaleString()} coins`,
            inline: true,
          },
          {
            name: '➕ Amount Added',
            value: `${amount.toLocaleString()} coins`,
            inline: true,
          }
        )
        .setFooter({ text: `Staff: ${interaction.user.username}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Send audit log
      const auditData: FactionAuditLogData = {
        actionType: 'faction_add_coins',
        staffUserId: interaction.user.id,
        staffUsername: interaction.user.username,
        factionId,
        factionName: result.factionName,
        amount,
        treasuryBefore: result.treasuryBefore,
        treasuryAfter: result.treasuryAfter,
        guildId,
        timestamp: new Date(),
      };

      await auditLogger.logFactionEconomyAction(interaction.client, auditData);

      logger.info(`Staff ${interaction.user.username} added ${amount} coins to faction ${result.factionName}`);
    } catch (error) {
      logger.error('Error in faction-add command:', error);
      await interaction.editReply({
        embeds: [createErrorEmbed('Error', 'An unexpected error occurred while adding coins to faction.')],
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
