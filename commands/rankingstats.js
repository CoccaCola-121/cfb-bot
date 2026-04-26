// ============================================================
// commands/rankingstats.js
// Stats-tab-only ranking summary
// Parses 5 side-by-side mini-tables with spacer columns between them
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getTeamName,
  getTeamLogoUrl,
} = require('../utils/data');
const {
  matchesTeam: sheetMatchesTeam,
} = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');
const { getUserTeam } = require('../utils/userMap');

// Rankings History workbook (separate from the NZCFL Info sheet).
const SHEET_ID =
  process.env.RANKINGS_HISTORY_SHEET_ID ||
  '129V_2xHRjmk7MXnIY8ABvhlloauBb4lBZqfGW08S0Oc';

// Stats tab gid (used as a reliable fallback if the named lookup fails).
const STATS_TAB_GID =
  process.env.RANKINGS_HISTORY_STATS_GID || '1827012639';

// ---------- helpers ----------

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strict, exact-alias matching. The previous substring / token-overlap
// logic was biting us: a "Michigan State" query was pulling rows that
// only contained "Michigan" because "Michigan State".includes("Michigan")
// and the two names share a token. We now require an *exact* normalized
// match against one of the team's known aliases (abbrev, region, name,
// full name, plus the common aliases in utils/sheets.js like tOSU).
function teamMatchesCell(cellValue, team) {
  const cell = normalize(cellValue);
  if (!cell) return false;

  // Primary: the alias set from utils/sheets.js already includes every
  // hand-mapped variant (tOSU, SMU, BYU, VT, etc.) and does exact match.
  if (sheetMatchesTeam(cellValue, team)) return true;

  // Secondary: our own local normalization may differ slightly (punctuation,
  // whitespace). Build the same set and require an *exact* normalized hit.
  const variants = [
    team?.abbrev || '',
    team?.region || '',
    team?.name || '',
    getTeamName(team),
    `${team?.region || ''} ${team?.name || ''}`.trim(),
  ]
    .map(normalize)
    .filter(Boolean);

  return variants.includes(cell);
}

function parseNumber(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------- sheet loading ----------

async function fetchStatsRows() {
  const tabsToTry = [
    'Stats',
    'Rankings History - Stats',
    'Ranking Stats',
    'Historical Stats',
  ];

  for (const tab of tabsToTry) {
    try {
      const rows = await fetchSheetCsv(SHEET_ID, tab);
      if (Array.isArray(rows) && rows.length > 1) {
        return { rows, tab };
      }
    } catch {
      // try next
    }
  }

  // Fallback: load by gid directly.
  try {
    const rows = await fetchSheetCsv(SHEET_ID, STATS_TAB_GID, true);
    if (Array.isArray(rows) && rows.length > 1) {
      return { rows, tab: `gid:${STATS_TAB_GID}` };
    }
  } catch {
    // fall through
  }

  return { rows: null, tab: '' };
}

// ---------- historical data tab (for "Last Ranked") ----------

async function fetchHistoricalRows() {
  const candidates = [
    'Historical Data',
    'Historical',
    'History',
    'Rankings History',
    'Rankings',
    'Weekly Rankings',
  ];
  for (const tab of candidates) {
    try {
      const rows = await fetchSheetCsv(SHEET_ID, tab);
      if (Array.isArray(rows) && rows.length > 1) return rows;
    } catch (err) {
      // try next; log once per failure for visibility
      if (process.env.DEBUG_RANKINGSTATS) {
        console.warn(`[rankingstats] named tab "${tab}" failed:`, err.message);
      }
    }
  }
  const gid = process.env.RANKINGS_HISTORY_HISTORICAL_GID;
  if (gid) {
    try {
      const rows = await fetchSheetCsv(SHEET_ID, gid, true);
      if (Array.isArray(rows) && rows.length > 1) return rows;
    } catch (err) {
      if (process.env.DEBUG_RANKINGSTATS) {
        console.warn('[rankingstats] historical gid fetch failed:', err.message);
      }
    }
  }
  return null;
}

// Pull a 4-digit year out of an arbitrary header cell. Accepts:
//   "2060 Preseason"           -> 2060
//   "60 Preseason"             -> 2060 (prepend "20")
//   "60 Playoff Rankings"      -> 2060
//   "CCG 60"                   -> 2060
//   "2060"                     -> 2060
// Returns '' if no plausible year is found.
function extractYearFromHeader(header) {
  const s = String(header || '');
  if (!s.trim()) return '';

  const m4 = s.match(/\b(20\d{2})\b/);
  if (m4) return m4[1];

  // Two-digit year with an adjacent season/week/playoff keyword.
  const m2 =
    s.match(
      /\b([5-9]\d|[0-4]\d)\s*(pre[-\s]?seasons?|playoffs?|seasons?|bowls?|ccg|champions?(?:hip)?|rankings?)/i
    ) ||
    s.match(
      /\b(pre[-\s]?seasons?|playoffs?|seasons?|bowls?|ccg|champions?(?:hip)?|rankings?)\s+([5-9]\d|[0-4]\d)\b/i
    );
  if (m2) {
    const twoDigit = /\d{2}/.exec(m2[0])?.[0];
    if (twoDigit) return `20${twoDigit}`;
  }
  return '';
}

/**
 * Scan the Historical Data tab right-to-left for the last column where
 * the team shows up in rows 2–28 (1-indexed), then read:
 *   • the column's week label from the header row (user-facing row 3
 *     most-likely, so we check rows 1–5 and pick the first with a
 *     week-ish string),
 *   • the year from the nearest "20XX Preseason" header to the left.
 *
 * Returns { label, year, col } or null if the team never appeared.
 */
function findLastRankedInfo(historicalRows, team) {
  if (!Array.isArray(historicalRows) || historicalRows.length < 2) return null;

  // Rows 2–28 (1-indexed) == indices 1..27.
  const rowStart = 1;
  const rowEnd = Math.min(historicalRows.length, 28);

  let maxCols = 0;
  for (let r = rowStart; r < rowEnd; r++) {
    const len = (historicalRows[r] || []).length;
    if (len > maxCols) maxCols = len;
  }
  if (maxCols === 0) return null;

  // Walk columns right-to-left until we find the team.
  let matchCol = -1;
  for (let c = maxCols - 1; c >= 0; c--) {
    let hit = false;
    for (let r = rowStart; r < rowEnd; r++) {
      const cell = historicalRows[r]?.[c];
      if (cell && teamMatchesCell(cell, team)) { hit = true; break; }
    }
    if (hit) { matchCol = c; break; }
  }
  if (matchCol < 0) return null;

  // Week label: prefer the first row (in the first ~10 rows) whose value
  // at matchCol looks like a week/CCG/playoff header. Falls back to the
  // first non-empty header cell. We check more rows now because the user
  // mentioned headers sometimes live in row 3 (1-indexed).
  const headerCandidates = Math.min(historicalRows.length, 10);
  const labelPattern = /(week\s*\d+|pre[-\s]?season|ccg|championship|playoff|quarterfinal|semifinal|bowl|champion|rankings?)/i;
  let label = '';
  for (let r = 0; r < headerCandidates; r++) {
    const h = String(historicalRows[r]?.[matchCol] || '').trim();
    if (h && labelPattern.test(h)) { label = h; break; }
  }
  if (!label) {
    for (let r = 0; r < headerCandidates; r++) {
      const h = String(historicalRows[r]?.[matchCol] || '').trim();
      if (h) { label = h; break; }
    }
  }

  // Year: scan columns right-to-left starting at matchCol. Try the label
  // itself first (e.g. "60 Playoff Rankings" -> 2060), then fall back to
  // any header with a plausible year.
  let year = '';
  if (label) year = extractYearFromHeader(label);

  for (let c = matchCol; c >= 0 && !year; c--) {
    for (let r = 0; r < headerCandidates; r++) {
      const h = String(historicalRows[r]?.[c] || '').trim();
      const y = extractYearFromHeader(h);
      if (y) { year = y; break; }
    }
  }

  return { label, year, col: matchCol };
}

// ---------- layout parsing ----------

/**
 * Find the row index containing the header row.
 * The first row that has any "team" / "teams" cell is treated as the header row.
 */
function findHeaderRowIndex(rows) {
  const limit = Math.min(rows.length, 20);
  for (let r = 0; r < limit; r++) {
    const norm = rows[r].map((c) => normalize(c));
    if (norm.some((c) => c === 'team' || c === 'teams')) return r;
  }
  return 0;
}

/**
 * Scan headers and identify 5 metric blocks.
 * For each known metric header, walk LEFT to find the nearest "team"/"teams" column.
 * For modifier columns (Seasons, Is Active?), look a few columns to the RIGHT of the metric.
 */
function findMetricBlocks(headers) {
  const h = headers.map(normalize);

  // All columns where a "team" / "teams" header appears
  const teamCols = [];
  for (let i = 0; i < h.length; i++) {
    if (h[i] === 'team' || h[i] === 'teams') teamCols.push(i);
  }

  const nearestTeamColLeft = (col) => {
    let best = -1;
    for (const tc of teamCols) {
      if (tc < col && tc > best) best = tc;
    }
    return best;
  };

  const findHeaderRight = (startCol, matcher, windowCols = 4) => {
    const end = Math.min(startCol + windowCols, h.length - 1);
    for (let j = startCol + 1; j <= end; j++) {
      if (matcher(h[j])) return j;
    }
    return -1;
  };

  const blocks = {
    totalWeeksRanked: null,
    consecutiveWeeksRanked: null,
    weeksRankedNumber1: null,
    totalWeeksTop10: null,
    bestStreakByTeam: null,
  };

  for (let i = 0; i < h.length; i++) {
    const cur = h[i];
    if (!cur) continue;

    const tc = nearestTeamColLeft(i);
    if (tc < 0) continue;

    // Total Weeks Ranked
    if (cur === 'total weeks ranked') {
      blocks.totalWeeksRanked = { teamCol: tc, valueCol: i };
      continue;
    }

    // Total Weeks Ranked In Top 10  (check BEFORE plain "total weeks ranked" would match)
    if (cur === 'total weeks ranked in top 10' || cur.includes('top 10')) {
      blocks.totalWeeksTop10 = { teamCol: tc, valueCol: i };
      continue;
    }

    // Consecutive Weeks Ranked (+ Seasons)
    if (cur === 'consecutive weeks ranked') {
      const seasonsCol = findHeaderRight(i, (x) => x === 'seasons', 2);
      blocks.consecutiveWeeksRanked = { teamCol: tc, valueCol: i, seasonsCol };
      continue;
    }

    // Weeks Ranked #1  (normalized: "weeks ranked 1")
    if (cur === 'weeks ranked 1') {
      blocks.weeksRankedNumber1 = { teamCol: tc, valueCol: i };
      continue;
    }

    // Best Streak by Team (+ Is Active? + Seasons)
    if (cur === 'best streak by team') {
      const activeCol = findHeaderRight(i, (x) => x === 'is active', 3);
      const seasonsCol = findHeaderRight(i, (x) => x === 'seasons', 4);
      blocks.bestStreakByTeam = {
        teamCol: tc,
        valueCol: i,
        activeCol,
        seasonsCol,
      };
      continue;
    }
  }

  return blocks;
}

// ---------- row parsing ----------

function parseStatsTab(rows, team) {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const headerRowIdx = findHeaderRowIndex(rows);
  const headers = rows[headerRowIdx].map((c) => String(c || '').trim());
  const blocks = findMetricBlocks(headers);

  const result = {
    totalWeeksRanked: null,
    consecutiveWeeksRanked: null,
    consecutiveWeeksSeasons: null,
    weeksRankedNumber1: null,
    totalWeeksTop10: null,
    bestStreakByTeam: null,
    bestStreakActive: null,
    bestStreakSeasons: null,
  };

  // Since each block is its own ranked list, a team's row varies by block.
  // Walk EVERY data row and check each block independently.
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const rawRow = rows[r] || [];
    const row = rawRow.map((c) => String(c || '').trim());

    // Total Weeks Ranked
    if (
      blocks.totalWeeksRanked &&
      result.totalWeeksRanked === null &&
      teamMatchesCell(row[blocks.totalWeeksRanked.teamCol], team)
    ) {
      result.totalWeeksRanked = parseNumber(
        row[blocks.totalWeeksRanked.valueCol]
      );
    }

    // Consecutive Weeks Ranked
    if (
      blocks.consecutiveWeeksRanked &&
      result.consecutiveWeeksRanked === null &&
      teamMatchesCell(row[blocks.consecutiveWeeksRanked.teamCol], team)
    ) {
      result.consecutiveWeeksRanked = parseNumber(
        row[blocks.consecutiveWeeksRanked.valueCol]
      );
      if (blocks.consecutiveWeeksRanked.seasonsCol >= 0) {
        result.consecutiveWeeksSeasons = parseNumber(
          row[blocks.consecutiveWeeksRanked.seasonsCol]
        );
      }
    }

    // Weeks Ranked #1
    if (
      blocks.weeksRankedNumber1 &&
      result.weeksRankedNumber1 === null &&
      teamMatchesCell(row[blocks.weeksRankedNumber1.teamCol], team)
    ) {
      result.weeksRankedNumber1 = parseNumber(
        row[blocks.weeksRankedNumber1.valueCol]
      );
    }

    // Total Weeks in Top 10
    if (
      blocks.totalWeeksTop10 &&
      result.totalWeeksTop10 === null &&
      teamMatchesCell(row[blocks.totalWeeksTop10.teamCol], team)
    ) {
      result.totalWeeksTop10 = parseNumber(
        row[blocks.totalWeeksTop10.valueCol]
      );
    }

    // Best Streak by Team (+ Is Active? + Seasons)
    if (
      blocks.bestStreakByTeam &&
      result.bestStreakByTeam === null &&
      teamMatchesCell(row[blocks.bestStreakByTeam.teamCol], team)
    ) {
      result.bestStreakByTeam = parseNumber(
        row[blocks.bestStreakByTeam.valueCol]
      );

      if (blocks.bestStreakByTeam.activeCol >= 0) {
        const activeRaw = String(
          row[blocks.bestStreakByTeam.activeCol] || ''
        )
          .trim()
          .toUpperCase();
        // Normalize to "Yes" / "No" / "—"
        if (activeRaw === 'YES') result.bestStreakActive = 'Yes';
        else if (activeRaw === 'NO') result.bestStreakActive = 'No';
        else if (activeRaw && activeRaw !== '#N/A')
          result.bestStreakActive = activeRaw;
      }

      if (blocks.bestStreakByTeam.seasonsCol >= 0) {
        result.bestStreakSeasons = parseNumber(
          row[blocks.bestStreakByTeam.seasonsCol]
        );
      }
    }
  }

  const foundAnything = Object.values(result).some((v) => v !== null);
  return foundAnything ? result : null;
}

// ---------- formatting ----------

function fmtWithSeasons(weeks, seasons) {
  if (weeks === null || weeks === undefined) return '**0**';
  if (seasons === null || seasons === undefined) return `**${weeks}**`;

  // Seasons values in the sheet are decimals like 9.79 — round to 2dp,
  // strip trailing zeros for tidier display.
  const seasonsStr = Number.isInteger(seasons)
    ? String(seasons)
    : Number(seasons.toFixed(2)).toString();

  return `**${weeks}** (${seasonsStr} seasons)`;
}

// ---------- command ----------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rankingstats')
    .setDescription("Show a team's historical ranking stats")
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation, e.g. OSU (defaults to your linked team if you ran /iam)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const teamArg = interaction.options.getString('team');
    let team = null;
    let abbrev = null;

    if (teamArg) {
      abbrev = teamArg.toUpperCase().trim();
      team = leagueData.teams.find(
        (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === abbrev
      );
      if (!team) {
        return interaction.editReply(
          `❌ No active team with abbreviation **${abbrev}**.`
        );
      }
    } else {
      team = await getUserTeam(leagueData, interaction.user.id);
      if (!team) {
        return interaction.editReply(
          '❌ No team specified and no linked coach found. ' +
            'Pass a team (e.g. `team: OSU`) or run `/iam coach:<your name>` first.'
        );
      }
      abbrev = String(team.abbrev || '').toUpperCase().trim();
    }

    const [{ rows }, historicalRows] = await Promise.all([
      fetchStatsRows(),
      fetchHistoricalRows().catch(() => null),
    ]);

    if (!rows) {
      return interaction.editReply(
        '❌ Could not find a usable Stats tab on the rankings history sheet.'
      );
    }

    const stats = parseStatsTab(rows, team);
    if (!stats) {
      return interaction.editReply(
        `❌ No ranking stats found for **${getTeamName(team)}**.`
      );
    }

    const lastRanked = historicalRows
      ? findLastRankedInfo(historicalRows, team)
      : null;

    let lastRankedDisplay = '—';
    if (lastRanked) {
      const year = lastRanked.year || '';
      const label = lastRanked.label || '';
      let text = '';
      if (year && label) {
        if (label.includes(year)) {
          // Label already has the full 4-digit year, use as-is.
          text = label;
        } else if (
          /^\d{2}\b/.test(label) &&
          year.length === 4 &&
          year.endsWith(label.slice(0, 2))
        ) {
          // Label starts with 2-digit year matching our 4-digit year:
          // "60 Playoff Rankings" -> "2060 Playoff Rankings"
          text = `20${label}`;
        } else {
          text = `${year} ${label}`;
        }
      } else if (label) {
        text = label;
      } else if (year) {
        text = year;
      }
      if (text) lastRankedDisplay = `**${text}**`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Historical Ranking Stats — ${getTeamName(team)}`)
      .setColor(0xf39c12)
      .addFields(
        {
          name: 'All-Time Weeks Ranked',
          value: `**${stats.totalWeeksRanked ?? 0}**`,
          inline: true,
        },
        {
          name: 'All-Time Weeks in Top 10',
          value: `**${stats.totalWeeksTop10 ?? 0}**`,
          inline: true,
        },
        {
          name: 'All-Time Weeks at #1',
          value: `**${stats.weeksRankedNumber1 ?? 0}**`,
          inline: true,
        },
        {
          name: 'Consecutive Weeks Ranked',
          value: fmtWithSeasons(
            stats.consecutiveWeeksRanked,
            stats.consecutiveWeeksSeasons
          ),
          inline: true,
        },
        {
          name: 'Best Streak by Team',
          value: fmtWithSeasons(
            stats.bestStreakByTeam,
            stats.bestStreakSeasons
          ),
          inline: true,
        },
        {
          name: 'Best Streak Active?',
          value: `**${stats.bestStreakActive || '—'}**`,
          inline: true,
        },
        {
          name: 'Last Ranked',
          value: lastRankedDisplay,
          inline: true,
        }
      )
      .setTimestamp();

    const logo = getTeamLogoUrl(team);
    if (logo) {
      embed.setThumbnail(logo);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};