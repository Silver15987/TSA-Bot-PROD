import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { database } from '../database/client';
import logger from '../core/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Admin tools for dashboard stats')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('reset-vc')
        .setDescription('Reset VC-based dashboard totals for all users in this server')
        .addBooleanOption(option =>
          option
            .setName('confirm')
            .setDescription('Type true to confirm resetting all VC totals')
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      // Verify admin permissions (extra safety in case default permissions are bypassed)
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: '❌ You need Administrator permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({
          content: '❌ This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'reset-vc':
          await handleResetVc(interaction, guildId);
          break;
        default:
          await interaction.reply({
            content: '❌ Unknown subcommand.',
            ephemeral: true,
          });
      }
    } catch (error) {
      logger.error('Error in dashboard command:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ An error occurred while processing your request.',
        });
      } else {
        await interaction.reply({
          content: '❌ An error occurred while processing your request.',
          ephemeral: true,
        });
      }
    }
  },
};

async function handleResetVc(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const confirm = interaction.options.getBoolean('confirm', true);

  if (!confirm) {
    await interaction.reply({
      content: '❌ Reset cancelled. Set `confirm` to true to perform the reset.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: '⏳ Resetting VC-based dashboard totals for all users. This may take a moment...',
    ephemeral: true,
  });

  try {
    const result = await database.users.updateMany(
      { guildId },
      {
        $set: {
          totalVcTime: 0,
          dailyVcTime: 0,
          weeklyVcTime: 0,
          monthlyVcTime: 0,
          dailyCoinsEarned: 0,
          weeklyCoinsEarned: 0,
          monthlyCoinsEarned: 0,
          updatedAt: new Date(),
        },
      }
    );

    await interaction.editReply({
      content: `✅ VC-based dashboard totals have been reset for **${result.modifiedCount}** users.\n\n` +
        'Historical records (transactions, VC activity) were left untouched.',
    });

    logger.warn(
      `Dashboard VC totals reset for guild ${guildId} by ${interaction.user.id}. ` +
      `Affected users: ${result.modifiedCount}`
    );
  } catch (error) {
    logger.error('Failed to reset VC dashboard totals:', error);
    await interaction.editReply({
      content: '❌ Failed to reset VC dashboard totals. Please check the logs for details.',
    });
  }
}

