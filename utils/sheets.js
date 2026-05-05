// ============================================================
//  utils/sheets.js  —  shared Google Sheets CSV helpers
// ============================================================

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((v) => String(v || '').trim()));
}

async function fetchSheetCsv(sheetId, tabIdentifier, byGid = false) {
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
  const param = byGid
    ? `&gid=${encodeURIComponent(tabIdentifier)}`
    : `&sheet=${encodeURIComponent(tabIdentifier)}`;
  const res = await fetch(base + param);
  if (!res.ok) throw new Error(`Sheet fetch failed (${res.status}): ${tabIdentifier}`);
  return parseCsv(await res.text());
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Build a set of normalized aliases for a Football-GM team object
function getTeamAliases(team) {
  const aliases = new Set();
  const abbrev = String(team?.abbrev || '').trim();
  const region = String(team?.region || '').trim();
  const name   = String(team?.name || '').trim();
  const full   = [region, name].filter(Boolean).join(' ').trim();

  [abbrev, region, name, full].filter(Boolean).forEach((a) => aliases.add(a));

  const mappings = {
    'Central Florida': 'UCF',
    'Southern Methodist': 'SMU',
    'Brigham Young': 'BYU',
    'Louisiana State': 'LSU',
    'North Carolina State': 'NC State',
    'Virginia Polytechnic Institute and State University': ['Virginia Tech', 'VT'],
    'Texas Christian': 'TCU',
    'Ohio State': 'tOSU',
    'Alabama-Birmingham': 'UAB',
    // The league JSON gives Michigan State the abbrev "MIST" instead
    // of the universally-used "MSU", so historical sheet rows written
    // "MSU" don't match the Spartans' alias set and silently drop out
    // of /h2h, /streaks, /familytree, etc. Add MSU explicitly.
    'Michigan State Spartans': 'MSU',
  };

  for (const [key, val] of Object.entries(mappings)) {
    if (full === key) {
      [].concat(val).forEach((v) => aliases.add(v));
    }
  }

  // Aliases to STRIP for collision-prone teams. The league JSON ships
  // some duplicate abbrevs (e.g. Ohio State and Oregon State both
  // abbrev'd "OSU"), which lets a CSV row written as "OSU" match the
  // wrong team via canonicalTeamName + first-match-wins. The sheet
  // disambiguates Ohio State as "tOSU" (added by the mappings above),
  // so drop bare "OSU" from Ohio State's alias set and let Oregon
  // State own it cleanly.
  const aliasBlocklist = {
    'Ohio State': ['OSU'],
  };

  for (const [key, blocked] of Object.entries(aliasBlocklist)) {
    if (full === key) {
      [].concat(blocked).forEach((v) => aliases.delete(v));
    }
  }

  return new Set([...aliases].map(normalize).filter(Boolean));
}

function matchesTeam(cellValue, team) {
  const v = normalize(cellValue);
  if (!v) return false;
  return getTeamAliases(team).has(v);
}

module.exports = { parseCsv, fetchSheetCsv, normalize, safeNum, getTeamAliases, matchesTeam };
