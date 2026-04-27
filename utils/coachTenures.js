// utils/coachTenures.js

const { fetchSheetCsvCached } = require('./sheetCache');
const { normalize } = require('./sheets');
const overrides = require('./h2hOverrides');

const SHEET_ID = process.env.NZCFL_RESUME_SHEET_ID;
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

  const rows = await fetchSheetCsvCached(SHEET_ID, RESUME_TAB);
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
