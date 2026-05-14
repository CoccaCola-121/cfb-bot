// ============================================================
//  deploy-commands.js
//  Run this ONCE (or after adding new commands) to register
//  slash commands with Discord:  node deploy-commands.js
// ============================================================

const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const { isCommandEnabled } = require('./config/enabledCommands');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && isCommandEnabled(command.data.name)) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Collect all guild IDs we want to register commands in.
// Supports the legacy GUILD_ID var, the NZCFL production guild, and the test guild.
const guildIds = [
  process.env.NZCFL_GUILD_ID || process.env.GUILD_ID,
  process.env.TEST_GUILD_ID,
]
  .filter(Boolean)              // remove undefined/empty values
  .filter((id, i, arr) => arr.indexOf(id) === i); // de-dupe in case GUILD_ID === NZCFL_GUILD_ID

(async () => {
  if (guildIds.length === 0) {
    console.error('❌ No guild IDs found. Set NZCFL_GUILD_ID (or GUILD_ID) and/or TEST_GUILD_ID.');
    process.exit(1);
  }

  console.log(`Registering ${commands.length} slash command(s) in ${guildIds.length} guild(s)...`);

  let successCount = 0;
  for (const guildId of guildIds) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
        { body: commands }
      );
      console.log(`   ✅ Registered in guild ${guildId}`);
      successCount++;
    } catch (error) {
      console.error(`   ❌ Failed to register in guild ${guildId}:`, error.message || error);
    }
  }

  if (successCount === guildIds.length) {
    console.log('✅ All slash commands registered successfully!');
    console.log('   Commands will appear in Discord within a few seconds.');
  } else {
    console.log(`⚠️  Registered in ${successCount}/${guildIds.length} guilds. See errors above.`);
  }
})();
