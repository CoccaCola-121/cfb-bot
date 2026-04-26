// ============================================================
//  utils/ccg.js
//
//  CCG titles are computed by cross-referencing:
//    - CCG sheet: year + winner team name (plain text like "Ohio State")
//    - Coach sheet: year + team name per coach (same plain text)
//
//  KEY DESIGN: we pass rawCoaches (before any patching/normalization)
//  so team names are exactly as they appear in the coach sheet.
//  Both sides are normalized the same way before matching.
//
//  Extra alias pairs handle known mismatches between the two sheets.
// ============================================================

const { normalize } = require('./sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('./sheetCache');

const CCG_SHEET_ID = '10xp0uWcijBFF7QDi3VjDC6LxWlH3ri7V9fi0KGPpko8';
const CCG_TAB_NAME = 'Tabellenblatt1';

// Alias pairs: if the CCG sheet uses one name and the coach sheet uses another,
// add both normalized forms here. Order doesn't matter — both directions work.
const ALIASES = [
  ['ohiostate',          'tosu'],
  ['northcarolina',      'unc'],
  ['notredame',          'nd'],
  ['alabamabirmingham',  'uab'],
  ['texaschristian',     'tcu'],
  ['brighamyoung',       'byu'],
  ['centralflorida',     'ucf'],
  ['southernmethodist',  'smu'],
  ['louisianastate',     'lsu'],
  ['northcarolinastate', 'ncstate'],
  ['pennstate',          'psu'],
  ['michiganstate',      'msu'],
  ['olemiss',            'mississippi'],
  ['alaskaanchorage',    'uaa'],
  ['virginiatech',       'vt'],
  ['texasam',            'tamu'],
  ['floridastate',       'fsu'],
];

// Build O(1) lookup: normalizedName → canonical (smallest of the pair)
const ALIAS_CANON = new Map();
for (const [a, b] of ALIASES) {
  ALIAS_CANON.set(a, a); // canonical = first of pair
  ALIAS_CANON.set(b, a);
}

function canon(name) {
  const n = normalize(name);
  return ALIAS_CANON.get(n) ?? n;
}

// ── Parse CCG sheet ──────────────────────────────────────────
function parseCCGRows(rows) {
  const results = [];
  let currentYear = null;
  for (const row of rows) {
    const c0 = (row[0] || '').trim();
    const c1 = (row[1] || '').trim();
    if (!c0 || c0 === 'Game') continue;
    const n = Number(c0);
    if (Number.isFinite(n) && n >= 2000 && n <= 2200) { currentYear = n; continue; }
    if (c0.includes('Title Game') && c1 && currentYear) {
      results.push({ year: currentYear, conf: c0.replace(/\s*Title Game\s*$/i, '').trim(), winner: c1 });
    }
  }
  return results;
}

// ── Build coach CCG map ──────────────────────────────────────
// rawCoaches: coach objects with .history (NOT patchedHistory)
//   Each history entry: { year: string, team: string|null, record: string|null }
// ccgResults: [{ year: number, conf: string, winner: string }]
//
// Returns Map<normalizedCoachName, { wins: Set<yearString> }>
function buildCoachCCGData(rawCoaches, ccgResults) {
  // Step 1: build year:canonTeam → coachNorm from raw history
  const lookup = new Map();
  for (const c of rawCoaches) {
    const cn = normalize(c.coach);
    for (const h of (c.history || [])) {
      if (!h.team || !h.year) continue;
      const key = `${h.year}:${canon(h.team)}`;
      // If multiple coaches at same team+year, last one wins (shouldn't happen)
      lookup.set(key, cn);
    }
  }

  // Step 2: for each CCG result, look up the coach
  const wins = new Map(); // coachNorm → Set<yearString>
  for (const { year, winner } of ccgResults) {
    const key = `${year}:${canon(winner)}`;
    const cn  = lookup.get(key);
    if (!cn) continue;
    if (!wins.has(cn)) wins.set(cn, new Set());
    wins.get(cn).add(String(year));
  }

  // Step 3: convert to expected format
  const result = new Map();
  for (const [cn, ws] of wins) {
    result.set(cn, { wins: ws, losses: new Set() });
  }
  return result;
}

// ── getConfTitles ────────────────────────────────────────────
// coachNorm: normalize(coach.coach)
// coachCCGData: Map from buildCoachCCGData
// Special case: 'legend' must not match 'legend4life' or similar
function getConfTitles(coachNorm, coachCCGData) {
  // Block substrings of 'legend' matching other coaches
  if (coachNorm !== 'legend' && coachNorm.startsWith('legend')) return 0;
  return coachCCGData.get(coachNorm)?.wins.size ?? 0;
}

async function fetchCCGData() {
  try {
    const rows = await fetchSheetCsv(CCG_SHEET_ID, CCG_TAB_NAME);
    return parseCCGRows(rows);
  } catch (e) {
    console.error('fetchCCGData error:', e.message);
    return [];
  }
}

module.exports = { fetchCCGData, buildCoachCCGData, getConfTitles };
