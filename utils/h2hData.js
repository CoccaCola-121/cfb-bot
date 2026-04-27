// utils/h2hData.js

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
const overrides = require('./h2hOverrides');

const SHEET_ID = process.env.NZCFL_STATS_SHEET_ID;
const STATS_TAB = process.env.NZCFL_STATS_TAB || 'Stats';

function makeGame(year, week, weekLabel, a, b, aScore, bScore, source) {
  const numericAScore = Number(aScore);
  const numericBScore = Number(bScore);
  const winner = numericAScore > numericBScore ? a : numericBScore > numericAScore ? b : null;
  const loser = numericAScore > numericBScore ? b : numericBScore > numericAScore ? a : null;

  return {
    year,
    week,
    weekLabel: weekLabel || (Number.isFinite(week) ? getWeekLabel(week) : null),
    teamA: a,
    teamB: b,
    scoreA: numericAScore,
    scoreB: numericBScore,
    winner,
    loser,
    source,
  };
}

function parseWeekCell(rawWeek) {
  const value = String(rawWeek || '').trim();
  if (!value) return { week: null, weekLabel: null };

  const numericWeek = Number(value);
  if (Number.isFinite(numericWeek)) {
    return { week: numericWeek, weekLabel: getWeekLabel(numericWeek) };
  }

  const lower = value.toLowerCase();
  if (/(^|\W)ccg(\W|$)|conference.*title/.test(lower)) {
    return { week: 13, weekLabel: 'Conference Championships' };
  }
  if (/bowl/.test(lower)) {
    return { week: 14, weekLabel: 'Bowl Week' };
  }
  if (/round of 16|quarterfinal/.test(lower)) {
    return { week: 15, weekLabel: 'Quarterfinals' };
  }
  if (/semifinal/.test(lower)) {
    return { week: 16, weekLabel: 'Semifinals' };
  }
  if (/national championship|title game|championship/.test(lower)) {
    return { week: 17, weekLabel: 'National Championship' };
  }

  return { week: null, weekLabel: value };
}

// ---------- CSV ----------

async function loadCsvGames() {
  const rows = await fetchSheetCsvCached(SHEET_ID, STATS_TAB);
  if (!rows) return [];

  const games = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];

    const year = Number(r[0]);
    const { week, weekLabel } = parseWeekCell(r[1]);

    const a = r[4];
    const b = r[5];
    const aScore = Number(r[6]);
    const bScore = Number(r[7]);

    if (!year || !a || !b || !Number.isFinite(week)) continue;

    games.push(makeGame(year, week, weekLabel, a, b, aScore, bScore, 'csv'));
  }

  return games;
}

// ---------- JSON ----------

function loadJsonGames() {
  const data = getLatestLeagueData();
  if (!data) return [];

  const currentSeason = getCurrentSeason(data);
  const weekMap = getCurrentSeasonWeekMap(data);
  const games = [];

  for (const g of getGamesForCurrentSeason(data)) {
    if (!g.teams || g.teams.length < 2) continue;
    if (typeof g.teams[0]?.pts !== 'number' || typeof g.teams[1]?.pts !== 'number') continue;

    const a = getTeamName(getTeamByTid(data, g.teams[0].tid));
    const b = getTeamName(getTeamByTid(data, g.teams[1].tid));
    const week = getGameWeek(g, weekMap);

    if (!a || !b || !Number.isFinite(week)) continue;

    games.push(
      makeGame(
        g.season ?? currentSeason,
        week,
        getWeekLabel(week),
        a,
        b,
        g.teams[0].pts,
        g.teams[1].pts,
        'json'
      )
    );
  }

  return games;
}

// ---------- load all ----------

async function loadAllGames() {
  const csv = await loadCsvGames();
  const json = loadJsonGames();

  const all = [...csv, ...json];

  // overrides
  for (const g of overrides.addGames) {
    all.push(
      makeGame(
        g.year,
        g.week,
        g.weekLabel || getWeekLabel(g.week),
        g.leftTeam,
        g.rightTeam,
        g.leftScore,
        g.rightScore,
        'override-add'
      )
    );
  }

  // dedupe
  const seen = new Set();
  const final = [];

  for (const g of all) {
    const key = [g.year, g.week, g.teamA, g.teamB].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    final.push(g);
  }

  return final.sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.week - b.week
  );
}

module.exports = {
  loadAllGames,
};
