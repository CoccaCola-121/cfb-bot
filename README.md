# 🏈 CFB League Discord Bot

A Discord bot for your 120-team college football league. Reads live stats from:
- **football-gm JSON exports** (loaded after each weekly sim)
- **Google Sheets** (coach records, custom stats)
- **Reddit** (league subreddit posts)

---

## 📁 Project Structure

```
cfb-bot/
├── index.js              ← Main bot file (start here)
├── deploy-commands.js    ← Run once to register slash commands
├── package.json          ← Dependencies
├── .env                  ← Your secret keys (never share this)
├── commands/
│   ├── help.js
│   ├── standings.js
│   ├── teamstats.js
│   ├── coachstats.js
│   ├── playerleaders.js
│   ├── scores.js
│   ├── redditnews.js
│   └── loadweek.js
├── utils/
│   └── data.js           ← All data-reading helpers
└── data/                 ← Auto-created; stores JSON exports
```

---

## 🚀 Setup Guide (Step by Step)

### Step 1 — Install Node.js
Download from **https://nodejs.org** (choose the LTS version). Install it like any program.

To verify it worked, open Terminal (Mac) or Command Prompt (Windows) and type:
```
node --version
```
You should see a version number like `v20.11.0`.

---

### Step 2 — Set up the Discord bot

1. Go to **https://discord.com/developers/applications**
2. Click **"New Application"** → give it a name (e.g. "CFB League Bot")
3. Click **"Bot"** in the left sidebar → click **"Add Bot"**
4. Under **"Token"**, click **"Reset Token"** → copy the token (save it, you'll need it)
5. Scroll down and enable these **Privileged Gateway Intents**:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. Click **"OAuth2"** → **"URL Generator"**
   - Check `bot` and `applications.commands`
   - Under Bot Permissions check: `Send Messages`, `Embed Links`, `Attach Files`, `Use Slash Commands`
7. Copy the generated URL and paste it in your browser to invite the bot to your server

**Copy these values — you'll need them for `.env`:**
- **Token** (from the Bot tab)
- **Application ID** (from the General Information tab — labeled "Application ID")
- **Guild/Server ID** (right-click your Discord server name → "Copy Server ID")
  - Note: You need Developer Mode on. Enable it in Discord → Settings → Advanced → Developer Mode

---

### Step 3 — Set up Google Sheets (for coach stats)

1. Create a new Google Sheet
2. Name the first tab exactly: `CoachStats`
3. Row 1 (headers): `Coach | Team | W | L | Conf_W | Conf_L | Bowl | Notes`
4. Fill in your coaches' data starting from Row 2
5. Click **Share** → change to **"Anyone with the link can view"**
6. Get the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_SHEET_ID/edit
   ```

**Get a free API key:**
1. Go to **https://console.cloud.google.com**
2. Create a new project
3. Search for "Google Sheets API" → Enable it
4. Go to **Credentials** → **Create Credentials** → **API Key**
5. Copy the API key

---

### Step 4 — Configure your `.env` file

In the `cfb-bot` folder, copy `.env.example` to a new file named `.env`:

```
DISCORD_TOKEN=paste_your_bot_token_here
CLIENT_ID=paste_your_application_id_here
GUILD_ID=paste_your_server_id_here
GOOGLE_SHEETS_API_KEY=paste_your_google_api_key_here
STATS_SHEET_ID=paste_your_sheet_id_here
REDDIT_SUBREDDIT=your_subreddit_name_without_r/
ADMIN_ROLE=Commissioner
```

> ⚠️ **Never share your `.env` file or commit it to GitHub.**

---

### Step 5 — Install and run

Open Terminal/Command Prompt in your `cfb-bot` folder and run:

```bash
# Install all dependencies (do this once)
npm install

# Register slash commands with Discord (do this once, or after adding new commands)
npm run deploy

# Start the bot
npm start
```

You should see:
```
✅ Loaded command: /standings
✅ Loaded command: /teamstats
...
🏈 Bot is online as CFB League Bot#1234
```

Leave this terminal window open — the bot runs as long as it's open.

---

### Step 6 — Daily workflow (after each weekly sim)

1. In football-gm, go to **Tools → Export → All data** → download the `.json` file
2. In Discord, type `/loadweek` and attach the downloaded file
3. That's it! All commands (`/standings`, `/scores`, `/playerleaders`, etc.) now reflect the new data

---

## 📋 Commands Reference

| Command | What it does |
|---|---|
| `/help` | Shows all commands |
| `/standings [conference]` | League standings (all or filtered by conference) |
| `/teamstats [team]` | Stats for a specific team (use abbreviation or city) |
| `/coachstats [name]` | Coach record from Google Sheets |
| `/playerleaders [stat]` | Top players in passing, rushing, tackles, etc. |
| `/scores [week]` | Game scores for a week (defaults to latest) |
| `/redditnews [sort]` | Latest posts from the league subreddit |
| `/loadweek` | Load a new JSON export (**commissioner only**) |

---

## 🔧 Customizing for Your League

### Add more stat columns to coach stats
Just add columns to your Google Sheet. The bot automatically detects and shows any extra columns.

### Change the Commissioner role name
Edit `ADMIN_ROLE=` in your `.env` file to match your Discord role name exactly.

### Add a custom command
1. Create a new file in `commands/` (e.g. `commands/schedule.js`)
2. Copy the structure from an existing command
3. Re-run `npm run deploy` to register it

### Map football-gm stat keys
The football-gm JSON uses these stat keys in `player.stats`:
- `pssYds` — passing yards
- `rusYds` — rushing yards  
- `recYds` — receiving yards
- `defTck` — tackles
- `defSk`  — sacks
- `defInt` — interceptions
- `pts`    — points/touchdowns

Add new options to `commands/playerleaders.js` to expose more categories.

---

## 🛠️ Keeping the Bot Online 24/7

Right now the bot only runs while your computer is on. For 24/7 uptime:
- **Free option**: Deploy to [Railway.app](https://railway.app) or [Render.com](https://render.com) (free tier)
- **Easy option**: Run on a Raspberry Pi or an old laptop

For Railway: push your code to GitHub, connect Railway to that repo, and set your `.env` values as environment variables in the Railway dashboard.

---

## ❓ Troubleshooting

**Bot is online but commands don't appear in Discord**
→ Make sure you ran `npm run deploy` after starting the bot. Commands can take up to 1 hour to appear globally, but guild-specific commands (which this uses) appear instantly.

**`/coachstats` says "Could not read Google Sheets"**
→ Check that your Sheet is set to "Anyone with link can view" and that your API key and Sheet ID are correct in `.env`.

**`/standings` says "No league data loaded"**
→ Run `/loadweek` with your football-gm export first.

**The bot crashes with a token error**
→ Double-check your `DISCORD_TOKEN` in `.env`. Make sure there are no extra spaces.
