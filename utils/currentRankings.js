// ============================================================
// utils/currentRankings.js
// Shared loader/parser for the current-season Top 25 from the
// mock committee rankings sheet ("Previous" tab). Used by:
//   • /rankings   — to render the Top 25
//   • /teamstats  — to prepend #X to the team title when ranked
// ============================================================

const { fetchSheetCsvCached } = require('./sheetCache');
const { matchesTeam } = require('./sheets');

const CURRENT_RANKINGS_SHEET_ID =
  process.env.CURRENT_RANKINGS_SHEET_ID ||
  '1aJif_Q2n6WJzwWpRCCQ-ofHoW7FfycbDnfADlAh682c';

const CURRENT_RANKINGS_TAB =
  process.env.CURRENT_RANKINGS_TAB || 'Previous';

/**
 * Parse the rankings sheet rows.
 * Returns { label, entries: [{ rank, name }, ...] } or null if unparseable.
 */
function parseCurrentRankings(rows, limit = 25) {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const headerRow = rows[0] || [];
  const rankCol = headerRow.findIndex(
    (cell) => String(cell || '').trim().toLowerCase() === 'rank'
  );
  if (rankCol < 0) return null;

  let teamCol = rankCol > 0 ? rankCol - 1 : -1;
  if (teamCol < 0 || !String(headerRow[teamCol] || '').trim()) {
    teamCol = headerRow.findIndex(
      (cell, index) => index !== rankCol && String(cell || '').trim()
    );
  }
  if (teamCol < 0) return null;

  const label = String(headerRow[teamCol] || '').trim() || 'Current Rankings';
  const entries = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const teamName = String(row[teamCol] || '').trim();
    const rankValue = String(row[rankCol] || '').trim();

    if (!teamName && !rankValue) continue;
    if (!teamName || !/^\d{1,2}$/.test(rankValue)) break;

    const rank = Number(rankValue);
    if (rank < 1 || rank > 25) break;

    entries.push({ rank, name: teamName });
    if (entries.length >= limit) break;
  }

  if (!entries.length) return null;
  return { label, entries };
}

/**
 * Fetch + parse the current Top 25. Returns { label, entries } on success
 * or { label: '', entries: [] } on any failure (so callers can no-op).
 */
async function fetchCurrentRankings({ limit = 25 } = {}) {
  let rows;
  try {
    rows = await fetchSheetCsvCached(
      CURRENT_RANKINGS_SHEET_ID,
      CURRENT_RANKINGS_TAB
    );
  } catch (err) {
    console.error('currentRankings fetch error:', err);
    return { label: '', entries: [] };
  }

  const parsed = parseCurrentRankings(rows, limit);
  return parsed || { label: '', entries: [] };
}

/**
 * Look up a team's current rank in the parsed entries.
 * Uses the shared alias-aware matcher from utils/sheets.js so spellings
 * like "Ohio State" / "tOSU" / "OSU" all collapse to the same team.
 * Returns the rank (1..25) or null if not ranked.
 */
function findRankForTeam(entries, team) {
  if (!Array.isArray(entries) || !team) return null;
  for (const entry of entries) {
    if (matchesTeam(entry.name, team)) return entry.rank;
  }
  return null;
}

module.exports = {
  CURRENT_RANKINGS_SHEET_ID,
  CURRENT_RANKINGS_TAB,
  parseCurrentRankings,
  fetchCurrentRankings,
  findRankForTeam,
};
