# 🏈 NZCFL Discord Bot

A Discord bot for the NZCFL — a 120-team college football league simulated in [Football-GM / ZenGM](https://zengm.com/football/). It serves stats, standings, schedules, recruiting, coaching history, and league lore directly in Discord.

Data sources:

- **Football-GM / ZenGM JSON exports** — uploaded after each weekly sim via `/loadweek`
- **Google Sheets** (Coach Sheet, Resume Sheet, Rankings History, Recruiting Ranks, Value Sheet) — read live via the public gviz CSV endpoint, with a 5-minute in-process cache
- **Reddit** — latest posts from the league subreddit

---

## Project Structure

```
cfb-bot/
├── index.js                ← Entry point: loads commands, starts client
├── deploy-commands.js      ← Registers slash commands with Discord
├── package.json
├── .env                    ← Secrets and IDs (never commit)
├── commands/               ← 33 slash commands, one file each
├── utils/
│   ├── data.js             ← League JSON loader, team/season helpers
│   ├── sheets.js           ← gviz CSV fetcher + normalize()
│   ├── sheetCache.js       ← Cached fetcher with TTL + request coalescing
│   ├── natTitles.js        ← National champion year list
│   ├── coachOverrides.js   ← Per-coach W/L overrides for mid-season hires
│   ├── userMap.js          ← Discord user → coach link (/iam)
│   ├── permissions.js      ← Role-based admin gating
│   ├── recruiting.js       ← Recruiting class helpers
│   ├── ccg.js              ← Conference championship game logic
│   └── weekLabels.js       ← Reg-season / postseason week labels
└── data/                   ← Auto-created; stores uploaded league JSON
```

---

## Setup

### 1. Install Node.js

Download the LTS build from [nodejs.org](https://nodejs.org). Verify in a terminal:

```
node --version
```

You should see `v20.x` or newer.

### 2. Create the Discord application

1. Go to <https://discord.com/developers/applications> and create a new application.
2. In the **Bot** tab, click **Reset Token** and save the token.
3. Enable these privileged intents on the bot: **Server Members Intent** and **Message Content Intent**.
4. In **OAuth2 → URL Generator**, check `bot` and `applications.commands`, then under bot permissions check `Send Messages`, `Embed Links`, `Attach Files`, and `Use Slash Commands`. Open the generated URL to invite the bot to your server.

You'll need three values for `.env`:

- **Token** — Bot tab
- **Application ID** — General Information tab
- **Server ID** — right-click your server (Discord → Settings → Advanced → Developer Mode must be on)

### 3. Wire up Google Sheets

The bot reads sheets through the public gviz CSV endpoint, so the sheets must be set to **"Anyone with the link can view"** but no API key is required. For each sheet you use, grab its ID from the URL:

```
https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit#gid=<TAB_GID>
```

The bot expects a few specific sheets, identified per-sheet in `.env`:

- **Info Sheet** — multi-tab sheet with Coach, Resume, Prestige, Tradition, Winning, Pro Potential, Education, Campus tabs (one Sheet ID with multiple tab GIDs)
- **Rankings History Sheet** — historical poll data
- **Recruiting Ranks Sheet** — 247-style class rankings
- **Value Sheet** — per-team value rankings

### 4. Configure `.env`

```ini
# Discord
DISCORD_TOKEN=...
CLIENT_ID=...
GUILD_ID=...
NZCFL_GUILD_ID=...                   # optional, for guild-scoped command deploy

# Permission roles (Discord role IDs, not names)
NZCFL_LEAGUE_OWNER_ROLE_ID=...
NZCFL_COMMISSIONER_ROLE_ID=...
NZCFL_MOD_ROLE_ID=...
NZCFL_LEGACY_MOD_ROLE_ID=...         # optional fallback

# Info Sheet (Coach, Resume, etc.)
NZCFL_INFO_SHEET_ID=...
NZCFL_INFO_GID_COACH=...
NZCFL_INFO_GID_PRESTIGE=...
NZCFL_INFO_GID_TRADITION=...
NZCFL_INFO_GID_WINNING=...
NZCFL_INFO_GID_PROPOT=...
NZCFL_INFO_GID_EDU=...
NZCFL_INFO_GID_CAMPUS=...
NZCFL_INFO_YEAR=2026                 # current league year
NZCFL_COACH_SHEET_TAB=Coaches
NZCFL_RESUME_SHEET_TAB=Resume

# Rankings History
RANKINGS_HISTORY_SHEET_ID=...
RANKINGS_HISTORY_STATS_GID=...
RANKINGS_HISTORY_HISTORICAL_GID=...

# Recruiting Ranks
NZCFL_RECRUITING_RANKS_SHEET_ID=...
NZCFL_RECRUITING_RANKS_SHEET_GID=...
NZCFL_RECRUITING_RANKS_SHEET_NAME=Ranks

# Value Sheet
NZCFL_VALUE_SHEET_ID=...
NZCFL_VALUE_SHEET_GID=...

# Reddit (optional)
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USER_AGENT=nzcfl-bot/1.0
REDDIT_SUBREDDIT=NZCFL

# Storage / runtime
DATA_DIR=./data                      # where uploaded league JSONs are saved
RAILWAY_VOLUME_MOUNT_PATH=/data      # set automatically on Railway
SHEET_CACHE_TTL_MS=300000            # default 5 min
```

> Never commit `.env` to git. Add it to `.gitignore` if it isn't already.

### 6. Install and run

```bash
npm install
npm run deploy        # register slash commands (run once, and after adding new commands)
npm start
```

You should see a long list of `✅ Loaded command: /...` lines followed by `🏈 Bot is online as <name>`.

---

## Weekly Workflow

After each league sim:

1. In ZenGM, **Tools → Export → All data** and save the `.json` (or `.json.gz`).
2. In Discord, run `/loadweek` and either attach the file directly **or** paste a URL to it.
3. Optionally pass a `label` (e.g. `week8`) so the file is named cleanly in `data/`.
4. All stat/standings commands now reflect the new sim.

`/loadweek` is restricted to mod roles defined in `.env`. The sheet cache is automatically invalidated on a successful load.

---

## Command Reference

### Personalize

| Command | Description |
|---|---|
| `/iam coach:<name>` | Link your Discord ID to your coach so other commands default to your team |
| `/iam` | Show your current link |
| `/iam clear:true` | Remove your link |
| `/recordupdate year:<yr> wins:<n> losses:<n>` | Hard-overwrite your W/L for a year (mid-season hires/departures) |
| `/recordupdate` | Show all your record overrides |
| `/recordupdate year:<yr> clear:true` | Remove that year's override |

### Stats & Standings

| Command | Description |
|---|---|
| `/standings [conference]` | Conference standings split by division |
| `/teamstats [team]` | Full stats, offense/defense ranks, recruiting snapshot |
| `/teamleaderboards <stat>` | Top 10 team stat leaderboards |
| `/teamschedule [team] [year]` | Current season, historical H2H schedules, or future OOC/TBD schedule view |
| `/playerleaders <stat>` | Top 10 players in any stat category |
| `/playerpage <player>` | Full player profile, ratings, stats |
| `/scores [week]` | Game scores for a week (defaults to latest) |
| `/boxscore <team> [week]` | Single-game box score with stat leaders |
| `/compareteams <team1> <team2>` | Side-by-side team comparison |
| `/injuries <team>` | Current injuries and redshirts |
| `/confoverview <conference>` | Conference-wide team stats summary |
| `/heismanwatch` | Top 10 Heisman contenders by stat formula |
| `/weeklypreview` | Top upcoming matchups ranked by hype |

### Coach Tools

| Command | Description |
|---|---|
| `/coachstats [name]` | Coach resume with career record, titles, and history |
| `/coachleaderboard [sort]` | Top coaches by formula, wins, win %, conf titles, or rings |
| `/openpositions [view] [conference]` | Ranks open coaching jobs by attractiveness |
| `/dynastytracker [min] [coach]` | Active coaches with 5+ year tenures, top 10 |

### History & Lore

| Command | Description |
|---|---|
| `/h2h opponent:<team\|coach> [as]` | Team/coach head-to-head with auto coach detection and 2025+ tracking |
| `/streaks [vs] [as] [active:no]` | Active streaks by default; use `active:no` for all-time streaks |
| `/familytree [as]` | Top teams/coaches you dominate and who dominate you |
| `/championships [year] [coach]` | National champions, or all conference + division winners for a given year |
| `/teamhistory <team>` | Coaching eras and championship years |
| `/trashtalk <team>` | Generate a playful jab at a rival, fueled by real stats |

### Recruiting

| Command | Description |
|---|---|
| `/recruitingclass <team>` | Upcoming class with 247-style rankings |
| `/toprecruits [position]` | Top recruits by position with commitments |

### Rankings

| Command | Description |
|---|---|
| `/rankingstats <team>` | All-time ranking history summary |
| `/valueboard [conference]` | Team value rankings |

### Mod-Only

| Command | Description |
|---|---|
| `/loadweek [jsonfile] [url] [label]` | Load a new Football-GM export from attachment or URL |
| `/datafiles` | Show stored league files + sheet cache state |

---

## Customizing

**Adding a command.** Drop a new file in `commands/` exporting `{ data, execute }`, then run `npm run deploy`.

**Adjusting sheet TTL.** Set `SHEET_CACHE_TTL_MS` in `.env` (default 300000 ms).

**Mod permissions.** The bot checks role IDs from `NZCFL_LEAGUE_OWNER_ROLE_ID`, `NZCFL_COMMISSIONER_ROLE_ID`, `NZCFL_MOD_ROLE_ID`, and `NZCFL_LEGACY_MOD_ROLE_ID`. Any of those grants admin command access.

**Football-GM stat keys** (handy when extending `/playerleaders`):

```
pssYds  passing yards         defTck  tackles
rusYds  rushing yards         defSk   sacks
recYds  receiving yards       defInt  interceptions
pts     points                fgM     field goals made
```

---

## 24/7 Hosting

The bot only runs while the host process is alive. Production options:

- **Railway** (used in production) — push to GitHub, connect the repo, set every `.env` value as a Railway variable. The bot auto-detects `RAILWAY_VOLUME_MOUNT_PATH` for persistent league JSON storage.
- **Render**, **Fly.io**, or any always-on VPS — same idea: clone the repo, set env vars, run `npm install && npm start`.
- **Local box / Raspberry Pi** — works fine, just keep the process supervised (e.g. `pm2`, `systemd`).

---

## Troubleshooting

**Commands don't appear in Discord.** Run `npm run deploy`. Guild-scoped commands appear instantly; global commands can take up to an hour.

**`/standings` says "No league data loaded".** Run `/loadweek` first. Files persist across restarts in `DATA_DIR`.

**A `/coachstats`-style command says it can't read the sheet.** Confirm the sheet is set to "Anyone with the link can view", and that the matching `*_SHEET_ID` and `*_GID` (or tab name) are correct in `.env`.

**Token error on startup.** Re-check `DISCORD_TOKEN` for stray whitespace.

**Permissions error on `/loadweek` or `/datafiles`.** Make sure your Discord user has one of the configured mod role IDs.
