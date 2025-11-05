import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('merchant')
    .setDescription('Merchant role abilities')
    .addSubcommand(subcommand =>
      subcommand
        .setName('trade')
        .setDescription('Trade coins with another user')
        .addUserOption(option =>
          option.setName('target').setDescription('Target user').setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName('amount').setDescription('Amount').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('invest')
        .setDescription('Invest coins for 24 hours')
        .addIntegerOption(option =>
          option.setName('amount').setDescription('Amount (min 10k)').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('market')
        .setDescription('Manipulate server-wide market')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ content: 'Merchant commands coming soon!', ephemeral: true });
  },
};

