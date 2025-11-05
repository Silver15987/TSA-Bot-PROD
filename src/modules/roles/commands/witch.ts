import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('witch')
    .setDescription('Witch role abilities')
    .addSubcommand(subcommand =>
      subcommand
        .setName('curse')
        .setDescription('Cast a curse on a user or faction')
        .addStringOption(option =>
          option.setName('target').setDescription('Target').setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('type')
            .setDescription('Curse type')
            .setRequired(true)
            .addChoices(
              { name: 'Earning Rate Reduction', value: 'earning_rate' },
              { name: 'Instant Loss', value: 'instant_loss' }
            )
        )
        .addIntegerOption(option =>
          option.setName('amount').setDescription('Amount').setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ content: 'Witch commands coming soon!', ephemeral: true });
  },
};

