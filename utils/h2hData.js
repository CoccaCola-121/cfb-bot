// utils/h2hData.js

const { fetchSheetCsvCached } = require('./sheetCache');
const { getLatestLeagueData, getTeamName } = require('./data');
const overrides = require('./h2hOverrides');

const SHEET_ID = process.env.NZCFL_STATS_SHEET_ID;
const STATS_TAB = process.env.NZCFL_STATS_TAB || 'Stats';

function makeGame(year, week, a, b, aScore, bScore, source) {
  const winner = aScore > bScore ? a : b;
  const loser = aScore > bScore ? b : a;

  return {
    year,
    week,
    teamA: a,
    teamB: b,
    scoreA: aScore,
    scoreB: bScore,
    winner,
    loser,
    source,
  };
}

// ---------- CSV ----------

async function loadCsvGames() {
  const rows = await fetchSheetCsvCached(SHEET_ID, STATS_TAB);
  if (!rows) return [];

  const games = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];

    const year = Number(r[0]);
    const week = Number(r[1]);

    const a = r[4];
    const b = r[5];
    const aScore = Number(r[6]);
    const bScore = Number(r[7]);

    if (!year || !a || !b) continue;

    games.push(makeGame(year, week, a, b, aScore, bScore, 'csv'));
  }

  return games;
}

// ---------- JSON ----------

function loadJsonGames() {
  const data = getLatestLeagueData();
  if (!data) return [];

  const games = [];

  for (const g of data.games || []) {
    if (!g.teams || g.teams.length < 2) continue;

    const a = getTeamName(data.teams[g.teams[0].tid]);
    const b = getTeamName(data.teams[g.teams[1].tid]);

    games.push(
      makeGame(
        g.season,
        g.day + 1,
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
        g.leftTeam,
        g.rightTeam,
        g.leftScore,
        g.rightScore,
        'override'
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