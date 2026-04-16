// ============================================================
//  utils/data.js
// ============================================================

const fs = require('fs');
const path = require('path');

const fetchFn = globalThis.fetch
  ? globalThis.fetch.bind(globalThis)
  : require('node-fetch');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ── File helpers ─────────────────────────────────────────────

function getLatestLeagueData() {
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      name: f,
      time: fs.statSync(path.join(DATA_DIR, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time);

  if (files.length === 0) return null;

  const filePath = path.join(DATA_DIR, files[0].name);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function saveLeagueData(jsonString, label) {
  const safeLabel = String(label || Date.now()).replace(/[^\w-]+/g, '_');
  const filename = `league_${safeLabel}.json`;
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, jsonString, 'utf8');
  return filename;
}

// ── Generic helpers ──────────────────────────────────────────

function safeNumber(value, fallback = 0) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

function formatPct(wins, losses, ties = 0) {
  const games = wins + losses + ties;
  if (games <= 0) return '0.000';
  return (wins / games).toFixed(3);
}

function formatRecord(w, l, t = 0) {
  return Number(t) > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function addCompetitionRanks(items, tieKeyFn) {
  if (!Array.isArray(items) || items.length === 0) return [];

  let rank = 1;

  return items.map((item, index) => {
    if (index === 0) {
      return { ...item, rank };
    }

    const prev = items[index - 1];
    const sameAsPrev = tieKeyFn(item) === tieKeyFn(prev);

    if (!sameAsPrev) {
      rank = index + 1;
    }

    return { ...item, rank };
  });
}

function getCurrentSeason(leagueData) {
  return leagueData?.gameAttributes?.season ?? null;
}

function getCurrentPhase(leagueData) {
  return leagueData?.gameAttributes?.phase ?? null;
}

function getTeamMap(leagueData) {
  const map = new Map();
  for (const team of leagueData?.teams || []) {
    map.set(team.tid, team);
  }
  return map;
}

function getTeamName(team) {
  if (!team) return 'Unknown Team';
  return `${team.region || ''} ${team.name || ''}`.trim();
}

function cleanDivisionName(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Unknown Division';

  if (raw.includes('-')) {
    const parts = raw.split('-');
    return parts.slice(1).join('-').trim() || raw;
  }

  return raw;
}

// ── Conference helpers ───────────────────────────────────────

function getConferenceName(leagueData, cid) {
  const confs = leagueData?.gameAttributes?.confs;
  if (!Array.isArray(confs)) return String(cid ?? 'Unknown Conference');

  const conf = confs.find((c) => c.cid === cid);
  return conf?.name || String(cid ?? 'Unknown Conference');
}

function getDivisionName(leagueData, did) {
  const divs = leagueData?.gameAttributes?.divs;
  if (!Array.isArray(divs)) return String(did ?? 'Unknown Division');

  const div = divs.find((d) => d.did === did);
  return cleanDivisionName(div?.name || String(did ?? 'Unknown Division'));
}

function getConferenceAbbrevFromName(name) {
  const normalized = String(name || '').toLowerCase().trim();

  if (normalized.includes('atlantic coast') || normalized === 'acc') return 'ACC';
  if (normalized.includes('big ten') || normalized === 'b1g') return 'B1G';
  if (normalized.includes('big 12') || normalized === 'b12') return 'B12';

  if (
    normalized.includes('pac-12') ||
    normalized.includes('pac 12') ||
    normalized.includes('pac12') ||
    normalized.includes('p12') ||
    normalized.includes('pacific 12') ||
    normalized.includes('pacific-12') ||
    normalized.includes('pacific twelve') ||
    normalized.includes('pacific coast')
  ) return 'P12';

  if (normalized.includes('southeastern') || normalized === 'sec') return 'SEC';
  if (normalized.includes('mountain west') || normalized === 'mw') return 'MW';
  if (normalized.includes('mid-american') || normalized === 'mac') return 'MAC';

  if (
    normalized.includes('conference usa') ||
    normalized.includes('conference-usa') ||
    normalized === 'c-usa' ||
    normalized === 'cusa'
  ) return 'C-USA';

  if (normalized.includes('american athletic') || normalized === 'aac') return 'AAC';
  if (normalized.includes('sun belt') || normalized === 'sun' || normalized === 'sb') return 'SUN';

  return String(name || 'Unknown');
}

function findConferenceByAbbrev(leagueData, abbrev) {
  const target = String(abbrev || '').toUpperCase().trim();
  const confs = Array.isArray(leagueData?.gameAttributes?.confs)
    ? leagueData.gameAttributes.confs
    : [];

  if (confs.length === 0) return null;

  let found = confs.find((c) => getConferenceAbbrevFromName(c.name) === target);
  if (found) return found;

  found = confs.find((c) => {
    const name = String(c.name || '').toLowerCase().trim();

    if (target === 'P12') {
      return (
        name.includes('pac') ||
        name.includes('p12') ||
        name.includes('pacific 12') ||
        name.includes('pacific coast')
      );
    }

    if (target === 'B1G') {
      return name.includes('big ten') || name.includes('b1g');
    }

    if (target === 'B12') {
      return name.includes('big 12') || name.includes('b12');
    }

    if (target === 'C-USA') {
      return name.includes('conference usa') || name.includes('c-usa') || name.includes('cusa');
    }

    if (target === 'SUN') {
      return name.includes('sun belt') || name === 'sun';
    }

    return name.includes(target.toLowerCase());
  });

  return found || null;
}

function getConferenceAbbrev(leagueData, cid) {
  return getConferenceAbbrevFromName(getConferenceName(leagueData, cid));
}

function findConferenceByAbbrev(leagueData, abbrev) {
  const target = String(abbrev || '').toUpperCase().trim();
  const confs = leagueData?.gameAttributes?.confs || [];
  return confs.find((c) => getConferenceAbbrevFromName(c.name) === target) || null;
}

// ── Team/player season/stat helpers ──────────────────────────

function getLatestTeamSeason(team, currentSeason = null) {
  const seasons = Array.isArray(team?.seasons) ? team.seasons : [];
  if (seasons.length === 0) return null;

  if (currentSeason !== null) {
    return seasons.find((s) => s.season === currentSeason) || null;
  }

  return seasons[seasons.length - 1] || null;
}

function getLatestTeamStats(team, currentSeason = null, playoffs = false) {
  const stats = Array.isArray(team?.stats) ? team.stats : [];
  if (stats.length === 0) return null;

  let filtered = stats;

  if (currentSeason !== null) {
    filtered = filtered.filter((s) => s.season === currentSeason);
  }

  filtered = filtered.filter((s) => Boolean(s.playoffs) === Boolean(playoffs));

  if (filtered.length === 0) return null;
  return filtered[filtered.length - 1];
}

function getLatestPlayerStats(player, currentSeason = null, playoffs = false) {
  const stats = Array.isArray(player?.stats) ? player.stats : [];
  if (stats.length === 0) return null;

  let filtered = stats;

  if (currentSeason !== null) {
    filtered = filtered.filter((s) => s.season === currentSeason);
  }

  filtered = filtered.filter((s) => Boolean(s.playoffs) === Boolean(playoffs));

  if (filtered.length === 0) return null;
  return filtered[filtered.length - 1];
}

// ── Games helpers ────────────────────────────────────────────

function getGamesForCurrentSeason(leagueData) {
  const currentSeason = getCurrentSeason(leagueData);
  const games = Array.isArray(leagueData?.games) ? leagueData.games : [];
  if (currentSeason === null) return games;
  return games.filter((g) => g.season === currentSeason);
}

function inferWeekFromGameDay(day) {
  if (typeof day !== 'number' || Number.isNaN(day)) return null;
  return day + 1;
}

function getGameTeams(game) {
  return Array.isArray(game?.teams) ? game.teams : [];
}

function getGameWinnerTid(game) {
  if (typeof game?.won?.tid === 'number') return game.won.tid;

  const teams = getGameTeams(game);
  if (teams.length < 2) return null;

  const aPts = safeNumber(teams[0].pts);
  const bPts = safeNumber(teams[1].pts);

  if (aPts > bPts) return teams[0].tid;
  if (bPts > aPts) return teams[1].tid;
  return null;
}

function getGamesBetweenTeams(leagueData, tidA, tidB) {
  return getGamesForCurrentSeason(leagueData).filter((g) => {
    const tids = getGameTeams(g).map((t) => t.tid);
    return tids.includes(tidA) && tids.includes(tidB);
  });
}

function getHeadToHeadRecord(leagueData, tidA, tidB) {
  let aWins = 0;
  let bWins = 0;

  for (const game of getGamesBetweenTeams(leagueData, tidA, tidB)) {
    const winnerTid = getGameWinnerTid(game);
    if (winnerTid === tidA) aWins += 1;
    if (winnerTid === tidB) bWins += 1;
  }

  return { aWins, bWins };
}

// ── League-wide standings ────────────────────────────────────

function getStandings(leagueData) {
  if (!leagueData || !Array.isArray(leagueData.teams)) return [];

  const currentSeason = getCurrentSeason(leagueData);

  const standings = leagueData.teams
    .filter((team) => !team.disabled)
    .map((team) => {
      const season = getLatestTeamSeason(team, currentSeason);
      if (!season) return null;

      return {
        tid: team.tid,
        name: getTeamName(team),
        abbrev: team.abbrev || '?',
        wins: safeNumber(season.won),
        losses: safeNumber(season.lost),
        ties: safeNumber(season.tied),
        conf: team.cid ?? season.cid ?? 0,
        div: team.did ?? season.did ?? 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (a.losses !== b.losses) return a.losses - b.losses;
      if (b.ties !== a.ties) return b.ties - a.ties;
      return a.name.localeCompare(b.name);
    });

  return addCompetitionRanks(standings, (x) => `${x.wins}-${x.losses}-${x.ties}`);
}

// ── Conference standings by division ─────────────────────────

function compareDivisionTeams(leagueData, a, b) {
  const aConfPct = Number(formatPct(a.confWins, a.confLosses, a.confTies));
  const bConfPct = Number(formatPct(b.confWins, b.confLosses, b.confTies));
  if (bConfPct !== aConfPct) return bConfPct - aConfPct;

  const aDivPct = Number(formatPct(a.divWins, a.divLosses, a.divTies));
  const bDivPct = Number(formatPct(b.divWins, b.divLosses, b.divTies));
  if (bDivPct !== aDivPct) return bDivPct - aDivPct;

  const h2h = getHeadToHeadRecord(leagueData, a.tid, b.tid);
  if (h2h.aWins !== h2h.bWins) {
    return h2h.bWins - h2h.aWins;
  }

  return a.name.localeCompare(b.name);
}

function getConferenceDivisionStandings(leagueData, conferenceAbbrev) {
  const conf = findConferenceByAbbrev(leagueData, conferenceAbbrev);
  if (!conf) return null;

  const currentSeason = getCurrentSeason(leagueData);

  const teams = (leagueData.teams || [])
    .filter((team) => !team.disabled && team.cid === conf.cid)
    .map((team) => {
      const season = getLatestTeamSeason(team, currentSeason);
      const stats = getLatestTeamStats(team, currentSeason, false);
      if (!season) return null;

      return {
        tid: team.tid,
        name: getTeamName(team),
        abbrev: team.abbrev || '?',
        cid: team.cid,
        did: team.did,
        divisionName: getDivisionName(leagueData, team.did),
        wins: safeNumber(season.won),
        losses: safeNumber(season.lost),
        ties: safeNumber(season.tied),
        confWins: safeNumber(season.wonConf),
        confLosses: safeNumber(season.lostConf),
        confTies: safeNumber(season.tiedConf),
        divWins: safeNumber(season.wonDiv),
        divLosses: safeNumber(season.lostDiv),
        divTies: safeNumber(season.tiedDiv),
        pts: safeNumber(stats?.pts),
        oppPts: safeNumber(stats?.oppPts),
      };
    })
    .filter(Boolean);

  const divisionMap = new Map();

  for (const team of teams) {
    if (!divisionMap.has(team.did)) {
      divisionMap.set(team.did, {
        did: team.did,
        divisionName: team.divisionName,
        teams: [],
      });
    }
    divisionMap.get(team.did).teams.push(team);
  }

  const divisions = [...divisionMap.values()]
    .map((division) => {
      const sortedTeams = [...division.teams].sort((a, b) => compareDivisionTeams(leagueData, a, b));

      const rankedTeams = [];
let currentRank = 1;

for (let i = 0; i < sortedTeams.length; i++) {
  if (i === 0) {
    rankedTeams.push({ ...sortedTeams[i], rank: 1 });
    continue;
  }

  const prev = sortedTeams[i - 1];
  const curr = sortedTeams[i];

  const sameConfRecord =
    curr.confWins === prev.confWins &&
    curr.confLosses === prev.confLosses &&
    curr.confTies === prev.confTies;

  const sameDivRecord =
    curr.divWins === prev.divWins &&
    curr.divLosses === prev.divLosses &&
    curr.divTies === prev.divTies;

  const h2h = getHeadToHeadRecord(leagueData, curr.tid, prev.tid);
  const h2hTied = h2h.aWins === h2h.bWins;

  if (sameConfRecord && sameDivRecord && h2hTied) {
    rankedTeams.push({ ...curr, rank: currentRank });
  } else {
    currentRank = i + 1;
    rankedTeams.push({ ...curr, rank: currentRank });
  }
}
      return {
        did: division.did,
        divisionName: division.divisionName,
        teams: rankedTeams,
      };
    })
    .sort((a, b) => a.divisionName.localeCompare(b.divisionName));

  return {
    cid: conf.cid,
    conferenceName: conf.name,
    conferenceAbbrev: getConferenceAbbrevFromName(conf.name),
    divisions,
  };
}

// ── Player helpers ───────────────────────────────────────────

function getLatestPosition(player) {
  if (Array.isArray(player.ratings) && player.ratings.length > 0) {
    return player.ratings[player.ratings.length - 1]?.pos || player.pos || '?';
  }
  return player.pos || '?';
}

function computeQbRating(stats) {
  const att = safeNumber(stats.pss);
  const cmp = safeNumber(stats.pssCmp);
  const yds = safeNumber(stats.pssYds);
  const td = safeNumber(stats.pssTD);
  const ints = safeNumber(stats.pssInt);

  if (att <= 0) return null;

  let a = ((cmp / att) - 0.3) * 5;
  let b = ((yds / att) - 3) * 0.25;
  let c = (td / att) * 20;
  let d = 2.375 - ((ints / att) * 25);

  a = Math.max(0, Math.min(2.375, a));
  b = Math.max(0, Math.min(2.375, b));
  c = Math.max(0, Math.min(2.375, c));
  d = Math.max(0, Math.min(2.375, d));

  return ((a + b + c + d) / 6) * 100;
}

function getPlayerSummaryStats(player, leagueData) {
  const currentSeason = getCurrentSeason(leagueData);
  const stats = getLatestPlayerStats(player, currentSeason, false);
  if (!stats) return null;

  return {
    passingYards: safeNumber(stats.pssYds),
    passingTD: safeNumber(stats.pssTD),
    intsThrown: safeNumber(stats.pssInt),
    qbRating: computeQbRating(stats),

    rushingYards: safeNumber(stats.rusYds),
    rushingTD: safeNumber(stats.rusTD),

    receivingYards: safeNumber(stats.recYds),
    receivingTD: safeNumber(stats.recTD),

    tackles: safeNumber(stats.defTckSolo) + safeNumber(stats.defTckAst),
    sacks: safeNumber(stats.defSk),
    interceptions: safeNumber(stats.defInt),
  };
}

function findPlayerByName(leagueData, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;

  const currentSeason = getCurrentSeason(leagueData);

  const candidates = (leagueData.players || [])
    .filter((player) => player.tid !== undefined && player.tid >= -1)
    .map((player) => {
      const fullName = `${player.firstName || ''} ${player.lastName || ''}`.trim();
      const hasCurrentStats = !!getLatestPlayerStats(player, currentSeason, false);

      let score = 0;
      const fullLower = fullName.toLowerCase();

      if (fullLower === q) score += 100;
      if (fullLower.startsWith(q)) score += 40;
      if (fullLower.includes(q)) score += 20;
      if ((player.lastName || '').toLowerCase() === q) score += 15;
      if (hasCurrentStats) score += 10;
      if (player.tid >= 0) score += 5;

      return { player, score, fullName };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.fullName.localeCompare(b.fullName);
    });

  return candidates[0]?.player || null;
}

// ── Team schedule helpers ────────────────────────────────────

function getTeamSchedule(leagueData, teamAbbrev) {
  const currentSeason = getCurrentSeason(leagueData);
  const team = (leagueData.teams || []).find(
    (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === String(teamAbbrev || '').toUpperCase()
  );

  if (!team) return null;

  const teamMap = getTeamMap(leagueData);

  const games = getGamesForCurrentSeason(leagueData)
    .filter((game) => getGameTeams(game).some((t) => t.tid === team.tid))
    .map((game) => {
      const teams = getGameTeams(game);
      if (teams.length < 2) return null;

      const self = teams.find((t) => t.tid === team.tid);
      const opp = teams.find((t) => t.tid !== team.tid);
      if (!self || !opp) return null;

      const week = inferWeekFromGameDay(game.day);
      const teamScore = safeNumber(self.pts);
      const oppScore = safeNumber(opp.pts);

      let result = '';
      if (teamScore > oppScore) result = 'W';
      else if (teamScore < oppScore) result = 'L';
      else result = 'T';

      return {
        week,
        opponentTid: opp.tid,
        opponent: getTeamName(teamMap.get(opp.tid)),
        opponentAbbrev: teamMap.get(opp.tid)?.abbrev || '?',
        teamScore,
        oppScore,
        result,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.week ?? 999) - (b.week ?? 999));

  return {
    season: currentSeason,
    team,
    games,
  };
}

// ── Team leaderboard helpers ─────────────────────────────────

function getTeamLeaderboards(leagueData, category, limit = 10) {
  const currentSeason = getCurrentSeason(leagueData);

  const rows = (leagueData.teams || [])
    .filter((team) => !team.disabled)
    .map((team) => {
      const season = getLatestTeamSeason(team, currentSeason);
      const stats = getLatestTeamStats(team, currentSeason, false);
      if (!season || !stats) return null;

      const gp = safeNumber(stats.gp, safeNumber(season.won) + safeNumber(season.lost) + safeNumber(season.tied));
      if (gp <= 0) return null;

      let value = null;

      switch (category) {
        case 'passing_offense':
          value = safeNumber(stats.pssYds) / gp;
          break;
        case 'rushing_offense':
          value = safeNumber(stats.rusYds) / gp;
          break;
        case 'total_offense':
          value = (safeNumber(stats.pssYds) + safeNumber(stats.rusYds)) / gp;
          break;
        case 'scoring_offense':
          value = safeNumber(stats.pts) / gp;
          break;
        case 'passing_defense':
          value = safeNumber(stats.oppPssYds) / gp;
          break;
        case 'rushing_defense':
          value = safeNumber(stats.oppRusYds) / gp;
          break;
        case 'total_defense':
          value = (safeNumber(stats.oppPssYds) + safeNumber(stats.oppRusYds)) / gp;
          break;
        case 'scoring_defense':
          value = safeNumber(stats.oppPts) / gp;
          break;
        default:
          return null;
      }

      return {
        tid: team.tid,
        team: getTeamName(team),
        abbrev: team.abbrev || '?',
        value: Number(value),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const defenseCats = new Set(['passing_defense', 'rushing_defense', 'total_defense', 'scoring_defense']);
      if (defenseCats.has(category)) {
        if (a.value !== b.value) return a.value - b.value;
      } else {
        if (b.value !== a.value) return b.value - a.value;
      }
      return a.team.localeCompare(b.team);
    });

  return addCompetitionRanks(rows, (r) => Number(r.value).toFixed(4)).slice(0, limit);
}

// ── Web helpers left intact ──────────────────────────────────

async function getSheetData(sheetRange) {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  const sheetId = process.env.STATS_SHEET_ID;

  if (!apiKey || !sheetId) {
    throw new Error('Missing GOOGLE_SHEETS_API_KEY or STATS_SHEET_ID in .env');
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetRange)}?key=${apiKey}`;

  const res = await fetchFn(url);
  const json = await res.json();

  if (json.error) throw new Error(`Sheets API error: ${json.error.message}`);
  return json.values || [];
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const [headers, ...data] = rows;
  return data.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))
  );
}

async function getRedditPosts(limit = 5, sort = 'new') {
  const sub = process.env.REDDIT_SUBREDDIT;
  if (!sub) throw new Error('REDDIT_SUBREDDIT not set in .env');

  const url = `https://www.reddit.com/r/${sub}/${sort}.json?limit=${limit}`;
  const res = await fetchFn(url, {
    headers: { 'User-Agent': 'CFBLeagueBot/1.0' },
  });

  if (!res.ok) throw new Error(`Reddit API returned ${res.status}`);

  const json = await res.json();
  return json.data.children.map((c) => c.data);
}

function buildTable(rows, columns) {
  const pad = (str, len, align = 'left') => {
    str = String(str ?? '').slice(0, len);
    return align === 'right' ? str.padStart(len) : str.padEnd(len);
  };

  const header = columns.map((c) => pad(c.header, c.width, c.align)).join('  ');
  const divider = columns.map((c) => '─'.repeat(c.width)).join('  ');
  const body = rows.map((row) =>
    columns.map((c) => pad(row[c.key], c.width, c.align)).join('  ')
  );

  return ['```', header, divider, ...body, '```'].join('\n');
}

function getTeamLogoUrl(team) {
  const url = String(team?.imgURL || '').trim();
  return url || null;
}

module.exports = {
  getLatestLeagueData,
  saveLeagueData,
  safeNumber,
  formatPct,
  formatRecord,
  addCompetitionRanks,
  getCurrentSeason,
  getCurrentPhase,
  getTeamMap,
  getTeamName,
  cleanDivisionName,
  getConferenceName,
  getDivisionName,
  getConferenceAbbrevFromName,
  getConferenceAbbrev,
  findConferenceByAbbrev,
  getLatestTeamSeason,
  getLatestTeamStats,
  getLatestPlayerStats,
  getGamesForCurrentSeason,
  inferWeekFromGameDay,
  getGameTeams,
  getGameWinnerTid,
  getGamesBetweenTeams,
  getHeadToHeadRecord,
  getStandings,
  getConferenceDivisionStandings,
  getLatestPosition,
  computeQbRating,
  getPlayerSummaryStats,
  findPlayerByName,
  getTeamSchedule,
  getTeamLeaderboards,
  getSheetData,
  rowsToObjects,
  getRedditPosts,
  buildTable,
  getTeamLogoUrl,
};