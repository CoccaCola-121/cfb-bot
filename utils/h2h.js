// ============================================================
// utils/h2h.js
// Consolidated head-to-head module.
// Replaces (and absorbs) the old utils/h2hData.js + utils/h2hSubjects.js.
//
// Owns:
//   - loading H2H games from CSV (Stats tab) + league JSON + manual overrides
//   - team / coach name canonicalisation
//   - subject + opponent functions for streakEngine
//
// Stays separate (and reused, not duplicated):
//   - utils/streakEngine.js   → record / streaks math
//   - utils/coachTenures.js   → coach-by-team-by-year attribution
//   - utils/h2hOverrides.js   → manual override data only
//   - utils/data.js           → league JSON access
// ============================================================

const { fetchSheetCsvCached } = require('./sheetCache');
const {
  getCurrentSeason,
  getCurrentSeasonWeekMap,
  getGameWeek,
  getGamesForCurrentSeason,
  getLatestLeagueData,
  getTeamByTid,
  getTeamName,
} = require('./data');
const { getWeekLabel } = require('./weekLabels');
const { matchesTeam } = require('./sheets');
const { coachAttribution, coachAliasesFor } = require('./coachTenures');
const overrides = require('./h2hOverrides');

// Sheet wiring — H2H lives in its own sheet, separate from the league Stats
// sheet that utils/data.js loads from STATS_SHEET_ID. Variables:
//   H2H_SHEET_ID  → spreadsheet ID for head-to-head history
//   H2H_TAB       → tab name (default "Stats")
//   H2H_GID       → numeric tab gid (preferred — survives tab renames)
// Legacy STATS_* / NZCFL_STATS_* are read as last-resort fallbacks for older
// configs. Hardcoded final fallback points at the live H2H sheet so the H2H
// trio (/h2h, /streaks, /familytree) still works if .env ever gets reset.
const SHEET_ID =
  process.env.H2H_SHEET_ID ||
  process.env.NZCFL_H2H_SHEET_ID ||
  process.env.STATS_SHEET_ID ||
  process.env.NZCFL_STATS_SHEET_ID ||
  '1bXibTnivjhlWZVbt2RpbALuxriFDWgdR8pscPf9zLhw';
const STATS_TAB =
  process.env.H2H_TAB ||
  process.env.NZCFL_H2H_TAB ||
  process.env.STATS_TAB ||
  process.env.NZCFL_STATS_TAB ||
  'Stats';
const STATS_GID =
  process.env.H2H_GID ||
  process.env.NZCFL_H2H_GID ||
  process.env.STATS_GID ||
  process.env.NZCFL_STATS_GID ||
  '495263146';

// ============================================================
// Name helpers
// ============================================================

function normKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

// Resolve a free-form team name string to its canonical "Region Name" form
// using the active league JSON. If we can't find a match (historical team,
// renamed school, etc.) just return the trimmed input.
function canonicalTeamName(name, leagueData) {
  if (!name) return null;
  const ld = leagueData || getLatestLeagueData();
  const trimmed = String(name).trim();
  if (!ld?.teams) return trimmed;
  for (const t of ld.teams) {
    if (t.disabled) continue;
    if (matchesTeam(trimmed, t)) return getTeamName(t);
  }
  return trimmed;
}

// True iff two strings name the same team. Tries direct normalised compare
// first, then any team in league JSON whose alias set contains both strings.
function sameTeam(a, b, leagueData) {
  if (!a || !b) return false;
  if (normKey(a) === normKey(b)) return true;
  const ld = leagueData || getLatestLeagueData();
  if (!ld?.teams) return false;
  for (const t of ld.teams) {
    if (t.disabled) continue;
    if (matchesTeam(a, t) && matchesTeam(b, t)) return true;
  }
  return false;
}

function coachMatches(input, actual) {
  if (!input || !actual) return false;
  if (normKey(input) === normKey(actual)) return true;
  const aA = coachAliasesFor(input).map(normKey);
  const aB = coachAliasesFor(actual).map(normKey);
  for (const x of aA) if (x && aB.includes(x)) return true;
  return false;
}

// ============================================================
// Game records
// ============================================================

function makeGame({ year, week, weekLabel, teamA, teamB, scoreA, scoreB, source }) {
  const sa = Number(scoreA);
  const sb = Number(scoreB);
  const winner =
    Number.isFinite(sa) && Number.isFinite(sb)
      ? sa > sb ? teamA : sb > sa ? teamB : null
      : null;
  const loser =
    Number.isFinite(sa) && Number.isFinite(sb)
      ? sa > sb ? teamB : sb > sa ? teamA : null
      : null;

  return {
    year: Number(year),
    week: Number(week),
    weekLabel: weekLabel || (Number.isFinite(Number(week)) ? getWeekLabel(week) : null),
    teamA,
    teamB,
    scoreA: Number.isFinite(sa) ? sa : null,
    scoreB: Number.isFinite(sb) ? sb : null,
    winner,
    loser,
    source,
  };
}

function parseWeekCell(raw) {
  const v = String(raw || '').trim();
  if (!v) return { week: null, weekLabel: null };

  const numeric = Number(v);
  if (Number.isFinite(numeric)) {
    return { week: numeric, weekLabel: getWeekLabel(numeric) };
  }

  const lower = v.toLowerCase();
  if (/(^|\W)ccg(\W|$)|conference.*(title|champ)/.test(lower)) {
    return { week: 13, weekLabel: 'Conference Championships' };
  }
  if (/bowl/.test(lower)) {
    return { week: 14, weekLabel: 'Bowl Week' };
  }
  if (/round of 16|quarterfinal|quarters?\b/.test(lower)) {
    return { week: 15, weekLabel: 'Quarterfinals' };
  }
  if (/semifinal|semis?\b/.test(lower)) {
    return { week: 16, weekLabel: 'Semifinals' };
  }
  if (/national champ|title game|natty/.test(lower)) {
    return { week: 17, weekLabel: 'National Championship' };
  }

  return { week: null, weekLabel: v };
}

function findHeaderIndex(header, candidates) {
  if (!Array.isArray(header) || !header.length) return -1;

  const normalized = header.map((cell) => normKey(cell));
  for (const candidate of candidates) {
    const idx = normalized.indexOf(normKey(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseCsvGameRow(row, header = []) {
  const yearIdx = findHeaderIndex(header, ['Year']);
  const weekIdx = findHeaderIndex(header, ['Week']);
  const leftTeamIdx = findHeaderIndex(header, ['Left Team', 'Team 1']);
  const rightTeamIdx = findHeaderIndex(header, ['Right Team', 'Team 2']);
  const leftScoreIdx = findHeaderIndex(header, ['Left Score', 'W']);
  const rightScoreIdx = findHeaderIndex(header, ['Right Score', 'L']);

  if (
    yearIdx !== -1 &&
    weekIdx !== -1 &&
    leftTeamIdx !== -1 &&
    rightTeamIdx !== -1 &&
    leftScoreIdx !== -1 &&
    rightScoreIdx !== -1
  ) {
    return {
      year: Number(row[yearIdx]),
      rawWeek: row[weekIdx],
      teamA: String(row[leftTeamIdx] || '').trim(),
      teamB: String(row[rightTeamIdx] || '').trim(),
      scoreA: Number(row[leftScoreIdx]),
      scoreB: Number(row[rightScoreIdx]),
    };
  }

  return {
    year: Number(row[0]),
    rawWeek: row[1],
    teamA: String(row[4] || '').trim(),
    teamB: String(row[5] || '').trim(),
    scoreA: Number(row[6]),
    scoreB: Number(row[7]),
  };
}

// ============================================================
// Sources
// ============================================================

async function loadCsvGames() {
  if (!SHEET_ID) {
    console.warn('[h2h] H2H_SHEET_ID not configured; skipping CSV load');
    return [];
  }
  console.log(
    `[h2h] csv load · sheet=${SHEET_ID.slice(0, 8)}… gid=${STATS_GID || '(none)'} tab=${STATS_TAB}`,
  );

  const attempts = [];
  if (STATS_GID) attempts.push({ tabId: STATS_GID, byGid: true });
  if (STATS_TAB) attempts.push({ tabId: STATS_TAB, byGid: false });

  let bestGames = [];

  for (const { tabId, byGid } of attempts) {
    let rows;
    try {
      rows = await fetchSheetCsvCached(SHEET_ID, tabId, byGid);
    } catch (err) {
      console.warn(
        `[h2h]   ${byGid ? 'gid' : 'tab'}=${tabId} → fetch FAILED: ${err.message}`,
      );
      continue;
    }
    console.log(
      `[h2h]   ${byGid ? 'gid' : 'tab'}=${tabId} → ${rows?.length ?? 0} rows`,
    );

    if (!Array.isArray(rows) || rows.length < 2) {
      console.log('[h2h]     skipping — not enough rows');
      continue;
    }

    const header = rows[0] || [];
    console.log(`[h2h]     header: ${JSON.stringify(header.slice(0, 12))}`);
    if (rows[1]) {
      console.log(`[h2h]     row[1]: ${JSON.stringify(rows[1].slice(0, 12))}`);
    }

    const games = [];
    let dropMissingFields = 0;
    let dropBadWeek = 0;
    let dropDash = 0;

    for (let i = 1; i < rows.length; i++) {
      const parsed = parseCsvGameRow(rows[i] || [], header);
      const { week, weekLabel } = parseWeekCell(parsed.rawWeek);

      if (!Number.isFinite(parsed.year) || !parsed.teamA || !parsed.teamB) {
        dropMissingFields++; continue;
      }
      if (!Number.isFinite(week)) { dropBadWeek++; continue; }
      if (parsed.teamA === '-' || parsed.teamB === '-') { dropDash++; continue; }

      games.push(
        makeGame({
          year: parsed.year,
          week,
          weekLabel,
          teamA: parsed.teamA,
          teamB: parsed.teamB,
          scoreA: parsed.scoreA,
          scoreB: parsed.scoreB,
          source: 'csv',
        })
      );
    }

    console.log(
      `[h2h]     kept ${games.length} games · dropped ` +
      `missingFields=${dropMissingFields} badWeek=${dropBadWeek} dash=${dropDash}`,
    );

    if (games.length > bestGames.length) bestGames = games;
  }

  console.log(`[h2h] csv load → ${bestGames.length} games total`);
  return bestGames;
}

function loadJsonGames() {
  const data = getLatestLeagueData();
  if (!data) return [];

  const currentSeason = getCurrentSeason(data);
  const weekMap = getCurrentSeasonWeekMap(data);
  const games = [];

  for (const g of getGamesForCurrentSeason(data) || []) {
    if (!g?.teams || g.teams.length < 2) continue;
    if (typeof g.teams[0]?.pts !== 'number' || typeof g.teams[1]?.pts !== 'number') continue;

    const a = getTeamName(getTeamByTid(data, g.teams[0].tid));
    const b = getTeamName(getTeamByTid(data, g.teams[1].tid));
    const week = getGameWeek(g, weekMap);

    if (!a || !b || !Number.isFinite(week)) continue;

    games.push(
      makeGame({
        year: g.season ?? currentSeason,
        week,
        weekLabel: getWeekLabel(week),
        teamA: a,
        teamB: b,
        scoreA: g.teams[0].pts,
        scoreB: g.teams[1].pts,
        source: 'json',
      })
    );
  }

  return games;
}

function loadOverrideGames() {
  const out = [];
  for (const g of overrides.addGames || []) {
    out.push(
      makeGame({
        year: g.year,
        week: g.week,
        weekLabel: g.weekLabel || getWeekLabel(g.week),
        teamA: g.leftTeam,
        teamB: g.rightTeam,
        scoreA: g.leftScore,
        scoreB: g.rightScore,
        source: 'override-add',
      })
    );
  }
  return out;
}

// ============================================================
// loadAllGames (cached)
// ============================================================

let cached = null;
let cachedAt = 0;
const TTL_MS = 60_000;

async function loadAllGames({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < TTL_MS) {
    return cached;
  }

  const csv = await loadCsvGames();
  const json = loadJsonGames();
  const ovr = loadOverrideGames();

  const all = [...csv, ...json, ...ovr];

  // Dedupe on (year, week, canonical-pair)
  const ld = getLatestLeagueData();
  const seen = new Set();
  const dedup = [];

  for (const g of all) {
    const ca = canonicalTeamName(g.teamA, ld);
    const cb = canonicalTeamName(g.teamB, ld);
    const pair = [normKey(ca), normKey(cb)].sort().join('|');
    const key = `${g.year}|${g.week}|${pair}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(g);
  }

  dedup.sort((a, b) => (a.year - b.year) || (a.week - b.week));

  cached = dedup;
  cachedAt = Date.now();
  return dedup;
}

function invalidateCache() {
  cached = null;
  cachedAt = 0;
}

// ============================================================
// Subjects + opponents (drives streakEngine)
// ============================================================

function teamSubjectFn(team, leagueData) {
  return (g) => {
    if (!sameTeam(g.teamA, team, leagueData) && !sameTeam(g.teamB, team, leagueData)) {
      return null;
    }
    if (!g.winner) return null;
    return sameTeam(g.winner, team, leagueData) ? 'win' : 'loss';
  };
}

function teamOpponentFn(team, leagueData) {
  return (g) => {
    if (sameTeam(g.teamA, team, leagueData)) return g.teamB;
    if (sameTeam(g.teamB, team, leagueData)) return g.teamA;
    return null;
  };
}

// Decide whether `coach` was on a side of `game`, honouring overrides.
async function coachSideForGame(game, coach) {
  const exclude = (overrides.excludeForCoach || []).find(
    (o) =>
      coachMatches(coach, o.coach) &&
      (o.year === undefined || o.year === game.year) &&
      (o.week === undefined || o.week === game.week) &&
      (o.team === undefined ||
        sameTeam(o.team, game.teamA) ||
        sameTeam(o.team, game.teamB))
  );
  if (exclude) return null;

  const aCoach = await coachAttribution(game.teamA, game.year, game.week);
  const bCoach = await coachAttribution(game.teamB, game.year, game.week);

  if (coachMatches(coach, aCoach)) return game.teamA;
  if (coachMatches(coach, bCoach)) return game.teamB;
  return null;
}

// Take a flat games[] and tag each game with which side `coach` was on.
// Drops games where attribution is null. Returned games carry hidden fields:
//   __subjectTeam, __subjectCoach, __subjectResult ('win'|'loss'|null)
async function hydrateCoachPerspective(games, coach) {
  const out = [];
  for (const game of games || []) {
    const side = await coachSideForGame(game, coach);
    if (!side) continue;
    out.push({
      ...game,
      __subjectTeam: side,
      __subjectCoach: coach,
      __subjectResult: game.winner
        ? sameTeam(game.winner, side)
          ? 'win'
          : 'loss'
        : null,
    });
  }
  return out;
}

function coachSubjectFn() {
  return (g) => g.__subjectResult || null;
}

function coachOpponentTeamFn() {
  return (g) => {
    if (!g.__subjectTeam) return null;
    return sameTeam(g.teamA, g.__subjectTeam) ? g.teamB : g.teamA;
  };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // loaders
  loadAllGames,
  invalidateCache,

  // helpers
  normKey,
  sameTeam,
  coachMatches,
  canonicalTeamName,
  parseWeekCell,
  makeGame,

  // subjects
  teamSubjectFn,
  teamOpponentFn,
  coachSideForGame,
  hydrateCoachPerspective,
  coachSubjectFn,
  coachOpponentTeamFn,
};
