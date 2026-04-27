// ============================================================
// utils/rankingsHistory.js
// Shared loader + parser for the Rankings History "Historical Data" tab.
// Used by /rankingstats (last-ranked field) and /rankings (top 25).
// ============================================================

const { fetchSheetCsvCached } = require('./sheetCache');
const { matchesTeam: sheetMatchesTeam } = require('./sheets');
const { getTeamName } = require('./data');

const SHEET_ID =
  process.env.RANKINGS_HISTORY_SHEET_ID ||
  '129V_2xHRjmk7MXnIY8ABvhlloauBb4lBZqfGW08S0Oc';

const HISTORICAL_GID = process.env.RANKINGS_HISTORY_HISTORICAL_GID || '';

const RANK_ROW_START = 1;     // skip the single header row
const RANK_ROW_END_HARD = 28; // top 25 lives in rows 1..27

function parseDisplayedRank(row, fallback) {
  if (!Array.isArray(row)) return fallback;

  for (const cell of row) {
    const value = String(cell || '').trim();
    if (!/^\d{1,2}$/.test(value)) continue;

    const rank = Number(value);
    if (rank >= 1 && rank <= 25) return rank;
  }

  return fallback;
}

// ----- normalize -----

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamMatchesCell(cellValue, team) {
  const cell = normalize(cellValue);
  if (!cell) return false;
  if (sheetMatchesTeam(cellValue, team)) return true;

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

// ----- header classification -----

function classifyHeader(rawHeader, col) {
  const s = String(rawHeader || '').trim();
  const lower = s.toLowerCase();

  // 1. Explicit 4-digit year
  let yearExplicit = null;
  const m4 = s.match(/\b(20\d{2})\b/);
  if (m4) yearExplicit = Number(m4[1]);

  // 2. Two-digit year only when paired with playoff/championship/rankings
  //    (NOT "preseason"/"season" — those are too easy to misfire on)
  if (!yearExplicit) {
    const m2 = s.match(/\b([0-4]\d|[5-9]\d)\s+(playoff|championship|rankings?)/i);
    if (m2) yearExplicit = Number('20' + m2[1]);
  }

  let weekKind = null;
  let weekNumber = null;

  if (/preseason/i.test(lower)) {
    weekKind = 'preseason';
  } else if (/(^|\W)ccg(\W|$)/i.test(lower)) {
    weekKind = 'ccg';
  } else if (/playoff|champion|rankings?/i.test(lower)) {
    weekKind = 'playoff';
  } else {
    const wm = s.match(/week\s*(\d+)/i);
    if (wm) {
      weekKind = 'week';
      weekNumber = Number(wm[1]);
    }
  }

  return {
    col,
    rawHeader: s,
    yearExplicit,
    weekKind,
    weekNumber,
    year: null, // populated by inheritance pass
  };
}

function buildColumnIndex(headerRow) {
  const cols = (headerRow || []).map((h, col) => classifyHeader(h, col));

  let currentYear = null;
  for (const c of cols) {
    if (c.yearExplicit != null) currentYear = c.yearExplicit;
    c.year = currentYear;
  }
  return cols;
}

// Phase ordering: Preseason < Weeks (by number) < CCG < Playoff
function phaseValue(c) {
  switch (c.weekKind) {
    case 'preseason': return 0;
    case 'week':      return 100 + (c.weekNumber || 0);
    case 'ccg':       return 1000;
    case 'playoff':   return 1100;
    default:          return 50;
  }
}

function compareCols(a, b) {
  if ((a.year ?? 0) !== (b.year ?? 0)) return (a.year ?? 0) - (b.year ?? 0);
  return phaseValue(a) - phaseValue(b);
}

// ----- loader -----

async function fetchHistoricalRows({ force = false } = {}) {
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
      const rows = await fetchSheetCsvCached(SHEET_ID, tab, false, { force });
      if (Array.isArray(rows) && rows.length > 1) return rows;
    } catch {
      // try next
    }
  }

  if (HISTORICAL_GID) {
    try {
      const rows = await fetchSheetCsvCached(SHEET_ID, HISTORICAL_GID, true, { force });
      if (Array.isArray(rows) && rows.length > 1) return rows;
    } catch {
      // fall through
    }
  }

  return null;
}

async function loadRankingsHistory({ force = false } = {}) {
  const rows = await fetchHistoricalRows({ force });
  if (!rows) return { rows: null, columnIndex: [] };

  const columnIndex = buildColumnIndex(rows[0]);
  return { rows, columnIndex };
}

// ----- queries -----

function eligibleColumnsForTeam(rows, team, columnIndex) {
  const dataEnd = Math.min(rows.length, RANK_ROW_END_HARD);
  const eligible = [];

  for (const c of columnIndex) {
    for (let r = RANK_ROW_START; r < dataEnd; r++) {
      const cell = rows[r]?.[c.col];
      if (cell && teamMatchesCell(cell, team)) {
        eligible.push(c);
        break;
      }
    }
  }
  return eligible;
}

function findLastRankedColumn(rows, team, columnIndex) {
  if (!rows || !columnIndex?.length) return null;
  const eligible = eligibleColumnsForTeam(rows, team, columnIndex);
  if (!eligible.length) return null;
  eligible.sort(compareCols);
  return eligible[eligible.length - 1];
}

// Latest column overall (no team filter): the furthest-right column that has
// at least one non-empty cell in the top-25 region.
function findLatestColumn(rows, columnIndex) {
  if (!rows || !columnIndex?.length) return null;
  const dataEnd = Math.min(rows.length, RANK_ROW_END_HARD);

  for (let i = columnIndex.length - 1; i >= 1; i--) {
    const column = columnIndex[i];
    for (let r = RANK_ROW_START; r < dataEnd; r++) {
      if (String(rows[r]?.[column.col] || '').trim()) {
        return column;
      }
    }
  }

  return null;
}

// Pull ranked entries from a column. Rank is taken from the first 1..25 value
// found on that row (the sheet's displayed rank cell), else falls back to the
// row index within the Top 25 block.
function readRankingColumn(rows, column, { limit = 25 } = {}) {
  if (!rows || !column) return [];
  const dataEnd = Math.min(rows.length, RANK_ROW_END_HARD);
  const out = [];

  for (let r = RANK_ROW_START; r < dataEnd; r++) {
    const cell = String(rows[r]?.[column.col] || '').trim();
    if (!cell) continue;

    const rank = parseDisplayedRank(rows[r], out.length + 1);
    out.push({ rank, name: cell });
    if (out.length >= limit) break;
  }
  return out;
}

function formatColumnLabel(c) {
  if (!c) return '—';
  const yr = c.year ?? '';
  switch (c.weekKind) {
    case 'preseason': return `${yr} Preseason`.trim();
    case 'ccg':       return `${yr} CCG`.trim();
    case 'playoff':   return `${yr} Playoff Rankings`.trim();
    case 'week':      return `${yr} Week ${c.weekNumber}`.trim();
    default:          return `${yr} ${c.rawHeader}`.replace(/\s+/g, ' ').trim();
  }
}

module.exports = {
  loadRankingsHistory,
  findLastRankedColumn,
  findLatestColumn,
  readRankingColumn,
  formatColumnLabel,
  // exported for tests / advanced callers
  buildColumnIndex,
  classifyHeader,
  compareCols,
  teamMatchesCell,
};
