import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID in .env file');
  process.exit(1);
}

async function refreshCommands() {
  try {
    console.log('Loading commands from src/commands...');

    const commandsPath = join(__dirname, '..', 'src', 'commands');
    const commandFiles = readdirSync(commandsPath).filter((file) =>
      file.endsWith('.ts') || file.endsWith('.js')
    );

    const commands = [];
    for (const file of commandFiles) {
      const filePath = join(commandsPath, file);
      const command = require(filePath).default;

      if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
        console.log(`Loaded command: ${command.data.name}`);
      }
    }

    // Load module commands (role-specific commands)
    console.log('\nLoading module commands from src/modules/roles/commands...');
    const modulesRolesCommandsPath = join(__dirname, '..', 'src', 'modules', 'roles', 'commands');
    try {
      const moduleCommandFiles = readdirSync(modulesRolesCommandsPath).filter((file) =>
        file.endsWith('.ts') || file.endsWith('.js')
      );

      for (const file of moduleCommandFiles) {
        const filePath = join(modulesRolesCommandsPath, file);
        try {
          const command = require(filePath).default;

          if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
            console.log(`Loaded module command: ${command.data.name}`);
          }
        } catch (error) {
          console.warn(`Failed to load module command file: ${file}`, error);
        }
      }
    } catch (error) {
      console.warn('Module commands directory not found or empty (this is okay)');
    }

    console.log(`\nFound ${commands.length} total commands`);
    console.log('Clearing old commands...');

    const rest = new REST({ version: '10' }).setToken(token);

    // Clear all global commands first
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log('Successfully cleared all old commands');

    console.log('Registering new commands...');

    // Register new commands
    await rest.put(Routes.applicationCommands(clientId), {
      body: commands,
    });

    console.log(`Successfully registered ${commands.length} commands:`);
    commands.forEach((cmd: any) => {
      console.log(`  - /${cmd.name}: ${cmd.description}`);
    });

    console.log('\nCommands refreshed! They should appear in Discord within 1-5 minutes.');
    console.log('If they don\'t appear immediately, try:');
    console.log('  1. Restart your Discord client');
    console.log('  2. Wait a few minutes for cache to clear');
  } catch (error) {
    console.error('Error refreshing commands:', error);
    process.exit(1);
  }
}

refreshCommands();
