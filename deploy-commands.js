// ============================================================
//  deploy-commands.js
//  Run this ONCE (or after adding new commands) to register
//  slash commands with Discord:  node deploy-commands.js
// ============================================================

const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash command(s)...`);

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log('✅ All slash commands registered successfully!');
    console.log('   Commands will appear in Discord within a few seconds.');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
})();
