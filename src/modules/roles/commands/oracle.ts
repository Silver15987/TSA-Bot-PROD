import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('oracle')
    .setDescription('Oracle role abilities')
    .addSubcommand(subcommand =>
      subcommand
        .setName('detect')
        .setDescription('Detect the identity of a Thief or Witch')
        .addUserOption(option =>
          option.setName('target').setDescription('Target user').setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ content: 'Oracle commands coming soon!', ephemeral: true });
  },
};

