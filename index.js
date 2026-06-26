process.on("unhandledRejection", error => {
  console.error("UNHANDLED REJECTION:", error);
});

process.on("uncaughtException", error => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

process.on("beforeExit", (code) => {
  console.log(`PROCESS BEFORE EXIT: code=${code}`);
});

process.on("exit", (code) => {
  console.log(`PROCESS EXIT: code=${code}`);
});

process.on("SIGTERM", () => {
  console.warn("PROCESS RECEIVED SIGTERM");
});

process.on("SIGINT", () => {
  console.warn("PROCESS RECEIVED SIGINT");
});

// ============================================================
//  CFB League Discord Bot  —  index.js
//  Entry point: loads config, registers commands, starts bot
// ============================================================

const {
  Client,
  GatewayIntentBits,
  Collection,
  Options,
} = require('discord.js');
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { isCommandEnabled } = require('./config/enabledCommands');

require('dotenv').config();

if (process.env.PORT) {
  const port = Number(process.env.PORT);
  const healthServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });

  healthServer.listen(port, () => {
    console.log(`Health server listening on port ${port}`);
  });

  healthServer.on('error', (error) => {
    console.error('HEALTH SERVER ERROR:', error);
  });
}

// ── Create the Discord client ────────────────────────────────
//
// We only handle slash-command interactions (`interactionCreate`),
// so we only need the Guilds intent. We also aggressively disable
// caches we never read from to keep resident memory low on small
// hosts like Railway.
const client = new Client({
  intents: [GatewayIntentBits.Guilds],

  // Keep only the bot itself in user/member caches; disable everything
  // else that discord.js otherwise grows unbounded.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0,
    ReactionManager: 0,
    PresenceManager: 0,
    VoiceStateManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
    StageInstanceManager: 0,
    GuildScheduledEventManager: 0,
    GuildStickerManager: 0,
    GuildEmojiManager: 0,
    GuildBanManager: 0,
    GuildInviteManager: 0,
    AutoModerationRuleManager: 0,
    GuildMemberManager: {
      maxSize: 1,
      keepOverLimit: (member) => member.id === member.client.user.id,
    },
    UserManager: {
      maxSize: 1,
      keepOverLimit: (user) => user.id === user.client.user.id,
    },
  }),

  // Periodically sweep anything that does sneak into the caches.
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 300, lifetime: 60 },
    users: { interval: 3600, filter: () => (u) => u.id !== u.client.user.id },
    guildMembers: { interval: 3600, filter: () => (m) => m.id !== m.client.user.id },
    threads: { interval: 3600, lifetime: 1800 },
  },
});

// ── Load all slash commands from /commands folder ────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    if (!isCommandEnabled(command.data.name)) {
      console.log(`⏭️ Skipped disabled command: /${command.data.name}`);
      continue;
    }
    client.commands.set(command.data.name, command);
    console.log(`✅ Loaded command: /${command.data.name}`);
  }
}

// ── Bot ready ────────────────────────────────────────────────
let loginWatchdog = null;

client.once('ready', () => {
  if (loginWatchdog) {
    clearTimeout(loginWatchdog);
    loginWatchdog = null;
  }

  console.log(`BOT LOGGED IN AS ${client.user.tag}`);
  console.log(`\n🏈 Bot is online as ${client.user.tag}`);
  console.log(`   Serving ${client.guilds.cache.size} server(s)\n`);

  // One-time memory snapshot so you can see baseline RSS in Railway logs.
  const mu = process.memoryUsage();
  console.log(
    `   Memory  rss=${(mu.rss / 1024 / 1024).toFixed(1)}MB ` +
    `heapUsed=${(mu.heapUsed / 1024 / 1024).toFixed(1)}MB ` +
    `external=${(mu.external / 1024 / 1024).toFixed(1)}MB`
  );
});

client.on('error', (error) => {
  console.error('DISCORD CLIENT ERROR:', error);
});

client.on('warn', (warning) => {
  console.warn('DISCORD CLIENT WARN:', warning);
});

client.on('shardReady', (shardId) => {
  console.log(`DISCORD SHARD READY: ${shardId}`);
});

client.on('shardDisconnect', (event, shardId) => {
  console.warn(
    `DISCORD SHARD DISCONNECT: shard=${shardId} code=${event.code} reason=${event.reason || '(no reason)'}`
  );
});

client.on('shardReconnecting', (shardId) => {
  console.warn(`DISCORD SHARD RECONNECTING: ${shardId}`);
});

client.on('shardResume', (shardId, replayedEvents) => {
  console.log(`DISCORD SHARD RESUMED: ${shardId} replayedEvents=${replayedEvents}`);
});

// Recurring memory log every 5 minutes so you can watch it trend over
// time in the Railway dashboard. Comment out if it's too noisy.
setInterval(() => {
  const mu = process.memoryUsage();
  console.log(
    `[mem] rss=${(mu.rss / 1024 / 1024).toFixed(1)}MB ` +
    `heap=${(mu.heapUsed / 1024 / 1024).toFixed(1)}MB`
  );
}, 5 * 60 * 1000).unref();

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
if (!process.env.DISCORD_TOKEN) {
  console.error('Missing required environment variable: DISCORD_TOKEN');
  process.exit(1);
}

console.log('Attempting Discord login...');
loginWatchdog = setTimeout(() => {
  console.warn('DISCORD LOGIN TIMEOUT: 30s elapsed without ready event');
}, 30 * 1000);

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  if (loginWatchdog) {
    clearTimeout(loginWatchdog);
    loginWatchdog = null;
  }

  console.error('DISCORD LOGIN FAILED:', error);
  process.exit(1);
});
