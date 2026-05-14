// ============================================================
//  commands/valueboard.js  —  NZCFL Info multi-category rankings
//
//  Pulls from the NZCFL Info Google Sheet (7 tabs):
//    • Coach     — positional layout (col B = Team, col C = Rank)
//    • Winning   — row-per-team, explicit Rank column
//    • Campus / Edu / ProPot / Tradition / Prestige
//        — year-column layout: team in the 2060 column,
//          rank inferred from row position (first row = rank 1)
//
//  Modes:
//    /valueboard                   → Average leaderboard (top 25)
//    /valueboard category:<Name>   → top 10 for that category
//    /valueboard team:<ABBR>       → one team's rank across all 7
//    /valueboard conference:<ABBR> → filter any leaderboard by conference
//
//  Display rules:
//    • Any rank ≤ 15 is bolded
//    • A team with 3+ top-15 ranks is marked as an "App School" 🎓
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData, getTeamName, getTeamLogoUrl, getConferenceLogoUrl,
  getConferenceName, getConferenceAbbrevFromName,
} = require('../utils/data');
const { normalize, matchesTeam, safeNum } = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');

// ── NZCFL Info sheet config ────────────────────────────────
const INFO_SHEET_ID = process.env.NZCFL_INFO_SHEET_ID
  || '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';

const TARGET_YEAR = process.env.NZCFL_INFO_YEAR || '2060';

const APP_SCHOOL_THRESHOLD      = 15; // top-15 ranks count as "application-level"
const APP_SCHOOL_REQUIRED_COUNT = 3;  // need 3+ such ranks to earn the tag

// Coach is tied to the current head coach and walks out the door with them.
// We still show it in team lookups and let users query it as its own
// leaderboard, but it never factors into the school-level value metrics
// (Average leaderboard, per-team Average, or App School qualification).
const SCHOOL_VALUE_KEYS = new Set(['Campus', 'Edu', 'ProPot', 'Tradition', 'Prestige', 'Winning']);
const isSchoolValueCat = (cat) => SCHOOL_VALUE_KEYS.has(cat.key);

const CATEGORIES = [
  { key: 'Coach',     label: 'Coach',     gid: process.env.NZCFL_INFO_GID_COACH     || '935723288',  type: 'coach'   },
  { key: 'Campus',    label: 'Campus',    gid: process.env.NZCFL_INFO_GID_CAMPUS    || '1373264378', type: 'year'    },
  { key: 'Edu',       label: 'Edu',       gid: process.env.NZCFL_INFO_GID_EDU       || '1190610143', type: 'year'    },
  { key: 'ProPot',    label: 'ProPot',    gid: process.env.NZCFL_INFO_GID_PROPOT    || '1653260831', type: 'year'    },
  { key: 'Tradition', label: 'Tradition', gid: process.env.NZCFL_INFO_GID_TRADITION || '1199440173', type: 'year'    },
  { key: 'Prestige',  label: 'Prestige',  gid: process.env.NZCFL_INFO_GID_PRESTIGE  || '618252130',  type: 'year'    },
  { key: 'Winning',   label: 'Winning',   gid: process.env.NZCFL_INFO_GID_WINNING   || '1968871678', type: 'winning' },
];

// ── Helpers ────────────────────────────────────────────────
function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '?';
  const m = num % 100;
  if (m >= 11 && m <= 13) return `${num}th`;
  switch (num % 10) {
    case 1: return `${num}st`; case 2: return `${num}nd`;
    case 3: return `${num}rd`; default: return `${num}th`;
  }
}

// Bold the ordinal if rank qualifies as top-15.
function formatRankCell(rank) {
  if (!Number.isFinite(rank) || rank <= 0) return '—';
  const str = ordinal(rank);
  return rank <= APP_SCHOOL_THRESHOLD ? `**${str}**` : str;
}

function findHeaderRow(rows, predicate, maxScan = 8) {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    if (predicate(rows[i].map((c) => c.toLowerCase().trim()))) return i;
  }
  return -1;
}

// ── Parsers ────────────────────────────────────────────────

// Coach tab: title row + header row at the top, then data.
// Column layout is fixed: A = Coach username, B = Team, C = Rank.
// Parser is positional (not header-based) so it survives wording changes.
// Also captures the coach name so leaderboards can display it.
function parseCoachSheet(rows) {
  if (!rows || rows.length < 2) return [];
  const out  = [];
  const seen = new Set();
  for (const row of rows) {
    const coach = String(row[0] || '').trim();  // column A
    const team  = String(row[1] || '').trim();  // column B
    const rank  = safeNum(row[2]);               // column C
    // Skip title/header rows (where C is text) and empty rows.
    if (!team || rank <= 0 || rank >= 500) continue;
    const key = team.toLowerCase();
    if (seen.has(key)) break;     // duplicate → stop (defends against secondary tables)
    seen.add(key);
    out.push({ team, rank, coach });
  }
  return out;
}

// Winning tab has THREE sections in order:
//   1. Main rankings table — header row 1, columns include explicit "Rank"
//   2. Secondary historical table — same teams but col K holds wins for an
//      old year, not the actual rank
//   3. "Inactive Schools" section
// We only want section 1, so break on the first duplicate team name.
function parseWinningSheet(rows) {
  if (!rows || rows.length < 2) return [];
  const hi = findHeaderRow(rows, (lc) => lc.includes('rank'));
  if (hi === -1) return [];

  const header  = rows[hi].map((c) => c.toLowerCase().trim());
  const rankCol = header.findIndex((c) => c === 'rank');
  let   teamCol = header.findIndex((c) => c === 'team' || c === 'school');
  if (teamCol === -1) teamCol = 0;
  if (rankCol === -1) return [];

  const out  = [];
  const seen = new Set();
  for (let i = hi + 1; i < rows.length; i++) {
    const row  = rows[i] || [];
    const team = String(row[teamCol] || '').trim();
    const rank = safeNum(row[rankCol]);
    if (!team || rank <= 0) continue;     // skip totals row, blank row, secondary header
    const key = team.toLowerCase();
    if (seen.has(key)) break;             // duplicate → start of section 2, stop here
    seen.add(key);
    out.push({ team, rank });
  }
  return out;
}

// Year-column tabs (Campus / Edu / ProPot / Tradition / Prestige):
// Header row has year labels (2052…2060) and a "Rank" column (typically column A).
// The Rank column is the AUTHORITATIVE rank — using row position breaks once the
// league expanded from 80 → 120 teams, since older year columns leave rows 83-122
// blank while newer year columns still hold valid teams in those rows.
function parseYearSheet(rows, targetYear) {
  if (!rows || rows.length < 3) return [];
  const target = String(targetYear);

  const hi = findHeaderRow(rows, (lc) => lc.some((c) => c === target.toLowerCase()), 8);
  if (hi === -1) return [];

  const headerLc = rows[hi].map((c) => c.toLowerCase().trim());
  const yearCol  = rows[hi].findIndex((c) => c.trim() === target);
  if (yearCol === -1) return [];

  // Locate the Rank column. Default to column A if no header label found.
  let rankCol = headerLc.findIndex((c) => c === 'rank');
  if (rankCol === -1) rankCol = 0;

  const results = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const row  = rows[i] || [];
    const team = String(row[yearCol] || '').trim();
    const rank = safeNum(row[rankCol]);
    // Skip rows missing either piece — never break, since blank rows can appear
    // anywhere in expansion-era data.
    if (!team || rank <= 0) continue;
    results.push({ team, rank });
  }
  return results;
}

// ── App School computation ─────────────────────────────────
// Returns a Map<normalizedTeamKey, { displayName, count }>
// where count = how many of this team's category ranks are ≤ threshold.
// Coach is intentionally excluded — see SCHOOL_VALUE_KEYS comment above.
function computeAppSchools(categoryData) {
  const counts = new Map();
  for (const cat of categoryData) {
    if (!isSchoolValueCat(cat)) continue;
    for (const entry of cat.entries) {
      const key = normalize(entry.team);
      if (!key) continue;
      if (!counts.has(key)) counts.set(key, { displayName: entry.team, count: 0 });
      if (entry.rank > 0 && entry.rank <= APP_SCHOOL_THRESHOLD) counts.get(key).count += 1;
    }
  }
  return counts;
}

function isAppSchool(appMap, teamName) {
  const info = appMap.get(normalize(teamName));
  return !!info && info.count >= APP_SCHOOL_REQUIRED_COUNT;
}

// ── Command ────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('valueboard')
    .setDescription(`NZCFL category rankings for ${TARGET_YEAR}`)
    .addStringOption((opt) =>
      opt.setName('category')
        .setDescription('Category leaderboard (default: Average)')
        .setRequired(false)
        .addChoices(
          { name: 'Average',   value: 'AVERAGE' },
          { name: 'Coach',     value: 'Coach' },
          { name: 'Campus',    value: 'Campus' },
          { name: 'Edu',       value: 'Edu' },
          { name: 'ProPot',    value: 'ProPot' },
          { name: 'Tradition', value: 'Tradition' },
          { name: 'Prestige',  value: 'Prestige' },
          { name: 'Winning',   value: 'Winning' },
        )
    )
    .addStringOption((opt) =>
      opt.setName('team')
        .setDescription('Look up one team by abbreviation (shows all 7 ranks)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('conference')
        .setDescription('Filter leaderboard to one conference')
        .setRequired(false)
        .addChoices(
          { name: 'ACC',   value: 'ACC' },   { name: 'B1G',   value: 'B1G' },
          { name: 'B12',   value: 'B12' },   { name: 'P12',   value: 'P12' },
          { name: 'SEC',   value: 'SEC' },   { name: 'MW',    value: 'MW'  },
          { name: 'MAC',   value: 'MAC' },   { name: 'C-USA', value: 'C-USA' },
          { name: 'AAC',   value: 'AAC' },   { name: 'SUN',   value: 'SUN' },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const leagueData = getLatestLeagueData();

    // Fetch and parse every tab in parallel
    let categoryData;
    try {
      categoryData = await Promise.all(
        CATEGORIES.map(async (cat) => {
          const rows = await fetchSheetCsv(INFO_SHEET_ID, cat.gid, true);
          let entries;
          if (cat.type === 'coach')        entries = parseCoachSheet(rows);
          else if (cat.type === 'winning') entries = parseWinningSheet(rows);
          else                             entries = parseYearSheet(rows, TARGET_YEAR);
          return { ...cat, entries };
        })
      );
    } catch (err) {
      return interaction.editReply(`❌ Could not load NZCFL Info sheet: ${err.message}`);
    }

    const empty = categoryData.filter((c) => c.entries.length === 0).map((c) => c.label);
    if (empty.length === CATEGORIES.length) {
      return interaction.editReply('❌ All categories returned empty — check the NZCFL Info sheet ID and GIDs.');
    }

    const appMap = computeAppSchools(categoryData);

    const teamQuery      = interaction.options.getString('team')?.toUpperCase().trim();
    const categoryChoice = interaction.options.getString('category') || 'AVERAGE';
    const confFilter     = interaction.options.getString('conference')?.toUpperCase();

    // ───── Team lookup mode ────────────────────────────────
    if (teamQuery) {
      if (!leagueData?.teams) return interaction.editReply('❌ League data unavailable.');
      const team = leagueData.teams.find(
        (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === teamQuery
      );
      if (!team) return interaction.editReply(`❌ No active team with abbreviation **${teamQuery}**.`);

      // Coach rank is still shown in the embed but excluded from the Average
      // and App-School counts — it leaves with the head coach, not the school.
      const fields  = [];
      const ranks   = [];
      let   top15   = 0;
      for (const cat of categoryData) {
        const entry = cat.entries.find((e) => matchesTeam(e.team, team));
        if (entry) {
          if (isSchoolValueCat(cat)) {
            ranks.push(entry.rank);
            if (entry.rank <= APP_SCHOOL_THRESHOLD) top15 += 1;
          }
          fields.push({ name: cat.label, value: formatRankCell(entry.rank), inline: true });
        } else {
          fields.push({ name: cat.label, value: '—', inline: true });
        }
      }

      const avgLine = ranks.length
        ? `**Average (of ${ranks.length}):** ${(ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(2)}`
        : '_No category data found for this team._';

      const appLine = top15 >= APP_SCHOOL_REQUIRED_COUNT
        ? `⭐ **App School** — ${top15} top-${APP_SCHOOL_THRESHOLD} ranks`
        : `${top15} top-${APP_SCHOOL_THRESHOLD} rank${top15 === 1 ? '' : 's'}`;

      const confName   = getConferenceName(leagueData, team.cid);
      const confAbbrev = getConferenceAbbrevFromName(confName);

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${getTeamName(team)} — ${TARGET_YEAR} Category Rankings`)
        .setColor(0x27ae60)
        .setDescription(`Conference: **${confAbbrev}**\n${avgLine}\n${appLine}`)
        .addFields(fields)
        .setFooter({ text: `NZCFL Info • ${TARGET_YEAR}` })
        .setTimestamp();

      const logo = getTeamLogoUrl(team);
      if (logo) embed.setThumbnail(logo);
      return interaction.editReply({ embeds: [embed] });
    }

    // ───── Leaderboard mode ────────────────────────────────
    let leaderboard;      // [{ team, rank, value }]  rank = display position, value = score to render
    let titleSuffix;
    let isAverageMode = false;
    let limit;

    if (categoryChoice === 'AVERAGE') {
      isAverageMode = true;
      limit = 25;

      // Coach is omitted here — see SCHOOL_VALUE_KEYS comment up top.
      const schoolCats = categoryData.filter(isSchoolValueCat);

      const teamMap = new Map(); // normalized key → { displayName, ranks[] }
      for (const cat of schoolCats) {
        for (const entry of cat.entries) {
          const key = normalize(entry.team);
          if (!key) continue;
          if (!teamMap.has(key)) teamMap.set(key, { displayName: entry.team, ranks: [] });
          teamMap.get(key).ranks.push(entry.rank);
        }
      }

      const totalCats = schoolCats.filter((c) => c.entries.length > 0).length;
      leaderboard = [...teamMap.values()]
        .filter((t) => t.ranks.length === totalCats)
        .map((t) => ({
          team:  t.displayName,
          value: t.ranks.reduce((a, b) => a + b, 0) / t.ranks.length,
        }))
        .sort((a, b) => a.value - b.value)
        .map((e, idx) => ({ ...e, rank: idx + 1 }));

      titleSuffix = `Average — mean rank across ${totalCats} school-value categories`;
    } else {
      limit = 10;
      const cat = categoryData.find((c) => c.key === categoryChoice);
      if (!cat)                return interaction.editReply('❌ Unknown category.');
      if (!cat.entries.length) return interaction.editReply(`❌ No data for **${cat.label}** — check GID.`);

      leaderboard = cat.entries
        .map((e) => ({ team: e.team, rank: e.rank, value: e.rank }))
        .sort((a, b) => a.rank - b.rank);

      titleSuffix = `${cat.label} — ${TARGET_YEAR}`;
    }

    // Conference filter (rank within filtered list becomes 1, 2, 3…)
    if (confFilter && leagueData?.teams) {
      leaderboard = leaderboard.filter((e) => {
        const match = leagueData.teams.find((t) => !t.disabled && matchesTeam(e.team, t));
        if (!match) return false;
        const ca = getConferenceAbbrevFromName(getConferenceName(leagueData, match.cid));
        return ca === confFilter;
      });
    }

    const top = leaderboard.slice(0, limit);
    if (!top.length) {
      return interaction.editReply(`No results${confFilter ? ` for **${confFilter}**` : ''}.`);
    }

    const lines = top.map((e, idx) => {
      const displayRank = confFilter ? idx + 1 : e.rank;
      const appBadge    = isAppSchool(appMap, e.team) ? ' ⭐' : '';
      if (isAverageMode) {
        return `\`${String(displayRank).padStart(3)}.\` **${e.team}**${appBadge} — ${e.value.toFixed(2)}`;
      }
      // Category mode: no redundant ordinal; bold team name if top-15
      const teamDisplay = displayRank <= APP_SCHOOL_THRESHOLD ? `**${e.team}**` : e.team;
      return `\`${String(displayRank).padStart(3)}.\` ${teamDisplay}${appBadge}`;
    });

    // Diagnostic: per-category team count. Makes it obvious if one sheet is
    // returning far fewer teams than the others (common sign of a parser issue).
    const counts = categoryData.map((c) => `${c.key}:${c.entries.length}`).join(' ');

    const embed = new EmbedBuilder()
      .setTitle(`📊 NZCFL ${titleSuffix}${confFilter ? ` · ${confFilter}` : ''}`)
      .setColor(0x27ae60)
      .setDescription(`${lines.join('\n')}\n\n⭐ = App School (${APP_SCHOOL_REQUIRED_COUNT}+ top-${APP_SCHOOL_THRESHOLD} ranks)`)
      .setFooter({ text: `NZCFL Info •` })
      .setTimestamp();

    if (confFilter && leagueData) {
      const logo = getConferenceLogoUrl(leagueData, confFilter);
      if (logo) embed.setThumbnail(logo);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};