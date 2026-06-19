const { fetchSheetCsvCached: fetchSheetCsv } = require('./sheetCache');
const { normalize, matchesTeam, findMatchingTeam } = require('./sheets');
const { getTeamName } = require('./data');

const CROOT_RANKINGS_SHEET_ID =
  process.env.NZCFL_CROOT_RANKINGS_SHEET_ID ||
  '1YvfuUK3uuWNubUL7_KX6JB-fMMnC-iKhlHTPq56s2gg';
const CROOT_RANKINGS_GID =
  process.env.NZCFL_CROOT_RANKINGS_GID ||
  '1062826171';

function normalizePos(pos) {
  const p = String(pos || '').toUpperCase().trim().replace(/[\s\d/\\.,-]+$/, '');
  if (['OT', 'OG', 'OC', 'C', 'LT', 'RT', 'LG', 'RG'].includes(p)) return 'OL';
  if (['DE', 'DT', 'NT', 'NG'].includes(p)) return 'DL';
  if (['ILB', 'OLB', 'MLB'].includes(p)) return 'LB';
  if (['FS', 'SS', 'SAF'].includes(p)) return 'S';
  if (['DB'].includes(p)) return 'CB';
  if (['PK', 'KK'].includes(p)) return 'K';
  if (['HB', 'FB'].includes(p)) return 'RB';
  return p;
}

function cleanHeaderKey(value) {
  return String(value || '').toLowerCase().trim().replace(/[.:?!]+$/, '').trim();
}

function getSchoolColumns(headerRow, committedCol) {
  return headerRow
    .map((cell, index) => ({ school: String(cell || '').trim(), index }))
    .filter(({ school, index }) => index > committedCol && school);
}

function loadNumeric(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function loadCrootRankings() {
  const rows = await fetchSheetCsv(CROOT_RANKINGS_SHEET_ID, CROOT_RANKINGS_GID, true);
  if (!Array.isArray(rows) || !rows.length) {
    return { recruits: [], schoolColumns: [] };
  }

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i += 1) {
    const cleaned = (rows[i] || []).map(cleanHeaderKey);
    if (cleaned.includes('name') && cleaned.includes('committed')) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    return { recruits: [], schoolColumns: [] };
  }

  const header = rows[headerIdx];
  const colMap = new Map();
  header.forEach((cell, index) => colMap.set(cleanHeaderKey(cell), index));

  const rankCol = 0;
  const nameCol = colMap.get('name');
  const posCol = colMap.get('pos');
  const committedCol = colMap.get('committed');
  if (nameCol == null || posCol == null || committedCol == null) {
    return { recruits: [], schoolColumns: [] };
  }

  const schoolColumns = getSchoolColumns(header, committedCol);
  const recruits = rows
    .slice(headerIdx + 1)
    .map((row) => {
      const name = String(row[nameCol] || '').trim();
      if (!name) return null;

      const fits = schoolColumns
        .map(({ school, index }) => ({
          school,
          fitRank: loadNumeric(row[index]),
        }))
        .filter((entry) => entry.fitRank !== null)
        .sort((a, b) => a.fitRank - b.fitRank);

      return {
        rank: loadNumeric(row[rankCol]),
        name,
        pos: normalizePos(row[posCol]),
        committed: String(row[committedCol] || '').trim(),
        fits,
      };
    })
    .filter(Boolean);

  return { recruits, schoolColumns };
}

function findRecruitByName(recruits, query) {
  const needle = normalize(query);
  if (!needle) return null;

  const exact = recruits.find((recruit) => normalize(recruit.name) === needle);
  if (exact) return exact;

  const startsWith = recruits
    .filter((recruit) => normalize(recruit.name).startsWith(needle))
    .sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity));
  if (startsWith.length) return startsWith[0];

  const includes = recruits
    .filter((recruit) => normalize(recruit.name).includes(needle))
    .sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity));
  return includes[0] || null;
}

function resolveRecruitingTeam(leagueData, query) {
  if (!query) return null;
  const direct = findMatchingTeam(leagueData, query);
  if (direct) return direct;

  const raw = normalize(query);
  return (leagueData?.teams || []).find((team) => {
    if (team.disabled) return false;
    const names = [
      team.abbrev,
      team.region,
      team.name,
      getTeamName(team),
    ].filter(Boolean);
    return names.some((name) => normalize(name) === raw);
  }) || null;
}

function getFitForTeam(recruit, team) {
  if (!recruit || !team) return null;
  return recruit.fits.find((fit) => matchesTeam(fit.school, team)) || null;
}

function formatCommitStatus(committed) {
  return committed ? committed : 'Uncommitted';
}

module.exports = {
  CROOT_RANKINGS_GID,
  CROOT_RANKINGS_SHEET_ID,
  normalizePos,
  loadCrootRankings,
  findRecruitByName,
  resolveRecruitingTeam,
  getFitForTeam,
  formatCommitStatus,
};
