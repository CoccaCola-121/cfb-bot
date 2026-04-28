// utils/coachTenures.js

const { fetchSheetCsvCached } = require('./sheetCache');
const { normalize } = require('./sheets');
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
  return result;
}

// ---------- public ----------

function coachAliasesFor(name) {
  if (!name) return [];
  const base = String(name).toLowerCase().trim();
  return [base, base.replace('@', '')];
}

async function getCoachForTeamYear(team, year) {
  const rows = await loadResume();
  const targetTeam = normalize(team);

  const match = rows.find(
    (r) =>
      r.year === year &&
      r.team &&
      normalize(r.team) === targetTeam
  );

  return match ? match.coach : null;
}

async function coachAttribution(team, year, week) {
  // 1. override FIRST
  const override = overrides.attributeCoach.find(
    (o) => o.team === team && o.year === year && o.week === week
  );
  if (override) return override.coach;

  // 2. fallback
  return getCoachForTeamYear(team, year);
}

module.exports = {
  getCoachForTeamYear,
  coachAttribution,
  coachAliasesFor,
};
