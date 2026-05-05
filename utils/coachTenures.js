// utils/coachTenures.js

const { fetchSheetCsvCached } = require('./sheetCache');
const { normalize, findMatchingTeam, canonicalTeamAlias } = require('./sheets');
const { getLatestLeagueData, getTeamName } = require('./data');
const overrides = require('./h2hOverrides');

// Resume sheet — same defaults as the rest of the bot
// (coachstats / coachleaderboard / dynastytracker / teamhistory / trashtalk
// all hard-code these). Env vars allow overrides but are not required.
const SHEET_ID =
  process.env.NZCFL_RESUME_SHEET_ID ||
  process.env.RESUME_SHEET_ID ||
  '1S3EcS3V6fxfN5qxF6R-MSb763AL6W11W-QqytehCUkU';
const RESUME_GID =
  process.env.NZCFL_RESUME_GID ||
  process.env.RESUME_GID ||
  '1607727992';
// Tab name fallback only used if no GID and no env override of name.
const RESUME_TAB = process.env.NZCFL_RESUME_TAB || 'Resume';

let cache = null;
let coachByTeamYearCache = null;
const attributionCache = new Map();

// ---------- helpers ----------

function parseRecord(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d+)[-–](\d+)/);
  if (!m) return null;
  return { wins: +m[1], losses: +m[2] };
}

function isYear(val) {
  return /^\d{4}$/.test(String(val).trim());
}

// ---------- load + parse ----------

async function loadResume() {
  if (cache) return cache;

  // Prefer GID-based fetch (matches other commands' usage of the same sheet).
  // Falls back to tab-name fetch if no GID is configured.
  const useGid = !!RESUME_GID;
  const tabId = useGid ? RESUME_GID : RESUME_TAB;
  let rows;
  try {
    rows = await fetchSheetCsvCached(SHEET_ID, tabId, useGid);
  } catch (err) {
    console.warn(
      `[coachTenures] Resume fetch failed (sheet=${SHEET_ID}, ${useGid ? 'gid' : 'tab'}=${tabId}): ${err.message}`,
    );
    return [];
  }
  if (!rows || rows.length < 2) return [];

  const header = rows[0];
  const yearCols = [];

  for (let i = 0; i < header.length; i++) {
    if (isYear(header[i])) yearCols.push({ year: +header[i], col: i });
  }

  const result = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const coach = String(row[0] || '').trim();
    if (!coach) continue;

    for (const { year, col } of yearCols) {
      const record = parseRecord(row[col]);
      const team = row[col + 1] ? String(row[col + 1]).trim() : null;

      if (!record && !team) continue;

      result.push({
        coach,
        year,
        team,
      });
    }
  }

  cache = result;
  coachByTeamYearCache = null;
  attributionCache.clear();
  return result;
}

// ---------- public ----------

function coachAliasesFor(name) {
  if (!name) return [];
  const base = String(name).toLowerCase().trim();
  return [base, base.replace('@', '')];
}

function canonicalTeamKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const aliased = canonicalTeamAlias(raw);
  if (aliased && aliased !== raw) {
    return normalize(aliased);
  }

  const leagueData = getLatestLeagueData();
  const matched = findMatchingTeam(leagueData, raw);
  if (matched) {
    return normalize(getTeamName(matched));
  }

  return normalize(raw);
}

async function getCoachForTeamYear(team, year) {
  const rows = await loadResume();
  const targetTeam = canonicalTeamKey(team);
  const targetYear = Number(year);

  if (!coachByTeamYearCache) {
    coachByTeamYearCache = new Map();
    for (const row of rows) {
      if (!row?.team || !Number.isFinite(Number(row.year))) continue;
      const key = `${Number(row.year)}|${canonicalTeamKey(row.team)}`;
      if (!coachByTeamYearCache.has(key)) {
        coachByTeamYearCache.set(key, row.coach || null);
      }
    }
  }

  return coachByTeamYearCache.get(`${targetYear}|${targetTeam}`) || null;
}

async function coachAttribution(team, year, week) {
  const cacheKey = `${year}|${week}|${canonicalTeamKey(team)}`;
  if (attributionCache.has(cacheKey)) {
    return attributionCache.get(cacheKey);
  }

  // 1. override FIRST
  const override = overrides.attributeCoach.find(
    (o) => o.team === team && o.year === year && o.week === week
  );
  if (override) {
    attributionCache.set(cacheKey, override.coach);
    return override.coach;
  }

  // 2. fallback
  const coach = await getCoachForTeamYear(team, year);
  attributionCache.set(cacheKey, coach);
  return coach;
}

module.exports = {
  getCoachForTeamYear,
  coachAttribution,
  coachAliasesFor,
};
