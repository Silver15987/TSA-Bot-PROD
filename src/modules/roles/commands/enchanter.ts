import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('enchanter')
    .setDescription('Enchanter role abilities')
    .addSubcommand(subcommand =>
      subcommand
        .setName('bless')
        .setDescription('Apply blessing to user or faction')
        .addStringOption(option =>
          option.setName('target').setDescription('Target').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('charm')
        .setDescription('Give instant coin boost')
        .addUserOption(option =>
          option.setName('target').setDescription('Target user').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('dispel')
        .setDescription('Remove curse from target')
        .addStringOption(option =>
          option.setName('target').setDescription('Target').setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ content: 'Enchanter commands coming soon!', ephemeral: true });
  },
};

