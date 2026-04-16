// ============================================================
//  utils/recruiting.js
// ============================================================

const SCHOLARSHIP_SHEET_ID = '11-87AU--uFWHfHCB3S2IbkVOrSNP2X3x1j_M5s1dFys';
const SCHOLARSHIP_GID = '1039825625';

const RECRUITING_SHEET_ID = '1VWzSOnixaQlJBQOw6zAyKdfo_XFhPuTFKO_5noKQEq4';
const RECRUITING_GID = '1491438927';

function normalizeTeamName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

function getAliasMap() {
  return {
    bc: ['boston college'],
    bostoncollege: ['bc'],

    ucf: ['central florida'],
    centralflorida: ['ucf'],

    smu: ['southern methodist'],
    southernmethodist: ['smu'],

    byu: ['brigham young', 'texas christian'],
    brighamyoung: ['byu'],
    tcu: ['texas christian'],
    texaschristian: ['tcu'],

    unc: ['north carolina'],
    northcarolina: ['unc'],

    usc: ['southern california'],
    southerncalifornia: ['usc'],

    uaa: ['alaska anchorage'],
    alaskaanchorage: ['uaa'],

    wsu: ['washington state'],
    washingtonstate: ['wsu'],

    osu: ['ohio state'],
    ohiostate: ['osu'],

    msu: ['michigan state'],
    michiganstate: ['msu'],

    psu: ['penn state'],
    pennstate: ['psu'],

    fsu: ['florida state'],
    floridastate: ['fsu'],

    gt: ['georgia tech'],
    georgiatech: ['gt'],

    vt: ['virginia tech'],
    virginiatech: ['vt'],

    nd: ['notre dame'],
    notredame: ['nd'],

    olemiss: ['mississippi'],
    mississippi: ['ole miss'],
  };
}

function buildVariants(...inputs) {
  const aliases = getAliasMap();
  const seen = new Set();

  for (const input of inputs) {
    const base = normalizeTeamName(input);
    if (!base) continue;
    seen.add(base);

    const queue = [base];
    while (queue.length) {
      const current = queue.shift();
      const extra = aliases[current] || [];
      for (const item of extra) {
        const normalized = normalizeTeamName(item);
        if (!seen.has(normalized)) {
          seen.add(normalized);
          queue.push(normalized);
        }
      }
    }
  }

  return seen;
}

function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }

  cells.push(cur);
  return cells.map((x) => x.trim());
}

function parseCsv(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}

async function fetchSheetCsv(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'cfb-bot/1.0',
      'Accept': 'text/csv,text/plain,*/*',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch sheet CSV: HTTP ${res.status}`);
  }

  return res.text();
}

function parseNumber(value) {
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  if (cleaned === '') return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function isScholarshipHeaderRow(row) {
  const a = String(row[0] || '').toLowerCase();
  const b = String(row[1] || '').toLowerCase();
  return a === 'school' || b === 'division';
}

function isRecruitingHeaderRow(row) {
  const a = String(row[0] || '').toLowerCase();
  const b = String(row[1] || '').toLowerCase();
  return a === 'rank' || b === 'score';
}

function findScholarshipRow(rows, schoolName, abbrev) {
  const variants = buildVariants(schoolName, abbrev);

  for (const row of rows) {
    if (!row.length || isScholarshipHeaderRow(row)) continue;
    const rowTeam = row[0];
    if (!rowTeam) continue;

    if (variants.has(normalizeTeamName(rowTeam))) {
      return row;
    }
  }

  return null;
}

function findRecruitingRow(rows, schoolName, abbrev) {
  const variants = buildVariants(schoolName, abbrev);

  for (const row of rows) {
    if (row.length < 4 || isRecruitingHeaderRow(row)) continue;

    const maybeTeam = row[1];
    if (!maybeTeam) continue;

    if (variants.has(normalizeTeamName(maybeTeam))) {
      return row;
    }
  }

  return null;
}

async function getScholarshipInfo({ schoolName, abbrev }) {
  const csv = await fetchSheetCsv(SCHOLARSHIP_SHEET_ID, SCHOLARSHIP_GID);
  const rows = parseCsv(csv);
  const row = findScholarshipRow(rows, schoolName, abbrev);

  if (!row) return null;

  return {
    team: row[0] || schoolName,
    divisionOrConference: row[1] || null,
    sos: parseNumber(row[2]),
    scholarshipsAvailable: parseNumber(row[3]),
    totalScholarshipsRemaining: parseNumber(row[4]),
    underclassmenScholarshipsUsed: parseNumber(row[5]),
    juniors: parseNumber(row[6]),
    sophomores: parseNumber(row[7]),
    freshmen: parseNumber(row[8]),
    incomingTransfers: parseNumber(row[9]),
    incomingFreshmen: parseNumber(row[10]),
    incomingFreshmen247: parseNumber(row[11]),
    sanctions: parseNumber(row[12]),
    notes: row[13] || null,
  };
}

async function getRecruitingInfo({ schoolName, abbrev }) {
  const csv = await fetchSheetCsv(RECRUITING_SHEET_ID, RECRUITING_GID);
  const rows = parseCsv(csv);
  const row = findRecruitingRow(rows, schoolName, abbrev);

  if (!row) return null;

  const recruitIds = row
    .slice(4)
    .map((x) => parseNumber(x))
    .filter((x) => x !== null);

  const bestRecruit = recruitIds.length ? Math.min(...recruitIds) : null;
  const averageRecruit = recruitIds.length
    ? recruitIds.reduce((sum, x) => sum + x, 0) / recruitIds.length
    : null;

  return {
    rank: parseNumber(row[0]),
    team: row[1] || schoolName,
    classScore: parseNumber(row[2]),
    recruitCount: parseNumber(row[3]),
    recruitIds,
    bestRecruit,
    averageRecruit,
  };
}

module.exports = {
  getScholarshipInfo,
  getRecruitingInfo,
};