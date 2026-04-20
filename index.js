// ============================================================
//  CFB League Discord Bot  —  index.js
//  Entry point: loads config, registers commands, starts bot
// ============================================================

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs   = require('fs');
const path = require('path');

require('dotenv').config();

// ── Create the Discord client ────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

// ── Load all slash commands from /commands folder ────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    console.log(`✅ Loaded command: /${command.data.name}`);
  }
}

// ── Bot ready ────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`\n🏈 Bot is online as ${client.user.tag}`);
  console.log(`   Serving ${client.guilds.cache.size} server(s)\n`);
});

// ── Handle slash command interactions ───────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error in /${interaction.commandName}:`, error);
    const msg = { content: '⚠️ There was an error running that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
});

// ── Log in ───────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);