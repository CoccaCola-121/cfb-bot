// ============================================================
//  utils/userMap.js
//  Stores discordUserId -> { coachName } and resolves the
//  user's *current* team by looking up the coach in the league
//  Coach Google Sheet. Coach name is the canonical key so when
//  a coach switches teams the mapping stays valid automatically.
// ============================================================

const fs = require('fs');
const path = require('path');
const { normalize } = require('./sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('./sheetCache');

const DATA_DIR =
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  process.env.DATA_DIR ||
  path.join(__dirname, '..', 'data');

const STORE_PATH = path.join(DATA_DIR, 'user_coaches.json');

const COACH_SHEET_ID =
  process.env.NZCFL_COACH_SHEET_ID ||
  '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';
const COACH_SHEET_TAB = process.env.NZCFL_COACH_SHEET_TAB || 'Coach';

// In-memory cache of the parsed coach sheet so we don't re-fetch on every
// /boxscore. TTL is short (5 min) so league updates propagate quickly.
const COACH_CACHE_TTL_MS = 5 * 60 * 1000;
let coachCache = { fetchedAt: 0, byCoach: null };

// ── Storage ──────────────────────────────────────────────────

function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const json = JSON.parse(raw);
    return json && typeof json === 'object' ? json : {};
  } catch {
    return {};
  }
}

function saveStore(store) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[userMap] saveStore failed:', err.message);
    return false;
  }
}

function getUserCoachName(userId) {
  if (!userId) return null;
  const store = loadStore();
  return store[String(userId)]?.coachName || null;
}

function setUserCoach(userId, coachName) {
  if (!userId || !coachName) return false;
  const store = loadStore();
  store[String(userId)] = {
    coachName: String(coachName).trim(),
    setAt: new Date().toISOString(),
  };
  return saveStore(store);
}

function clearUserCoach(userId) {
  if (!userId) return false;
  const store = loadStore();
  if (!store[String(userId)]) return false;
  delete store[String(userId)];
  return saveStore(store);
}

// ── Coach sheet → team lookup ────────────────────────────────

function findCoachHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const r = (rows[i] || []).map((c) => String(c || '').toLowerCase().trim());
    if (
      r.includes('coach') &&
      (r.includes('team') || r.includes('school') || r.includes('program'))
    ) {
      return i;
    }
  }
  // Fall back: whichever first row contains "coach".
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const r = (rows[i] || []).map((c) => String(c || '').toLowerCase().trim());
    if (r.some((c) => c === 'coach')) return i;
  }
  return -1;
}

async function loadCoachIndex({ force = false } = {}) {
  const now = Date.now();
  if (
    !force &&
    coachCache.byCoach &&
    now - coachCache.fetchedAt < COACH_CACHE_TTL_MS
  ) {
    return coachCache.byCoach;
  }

  let rows;
  try {
    rows = await fetchSheetCsv(COACH_SHEET_ID, COACH_SHEET_TAB);
  } catch (err) {
    if (process.env.DEBUG_USERMAP) {
      console.warn('[userMap] coach sheet fetch failed:', err.message);
    }
    return coachCache.byCoach || new Map();
  }

  if (!Array.isArray(rows) || rows.length < 2) {
    return coachCache.byCoach || new Map();
  }

  const hi = findCoachHeaderRow(rows);
  const headerIdx = hi >= 0 ? hi : 0;
  const headers = (rows[headerIdx] || []).map((c) =>
    String(c || '').toLowerCase().trim()
  );
  const coachCol = headers.findIndex((h) => h === 'coach');
  const teamCol = headers.findIndex(
    (h) => h === 'team' || h === 'school' || h === 'program'
  );

  // Fallback to col 0/1 if the headers aren't quite as expected.
  const ci = coachCol >= 0 ? coachCol : 0;
  const ti = teamCol >= 0 ? teamCol : 1;

  const byCoach = new Map();
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const coach = String(row[ci] || '').trim();
    const team = String(row[ti] || '').trim();
    if (!coach || !team) continue;
    byCoach.set(normalize(coach), { coach, team });
  }

  coachCache = { fetchedAt: now, byCoach };
  return byCoach;
}

// Resolve a coach name to the FM team object using the Coach sheet
// for the coach->teamString mapping, then matching teamString against
// the league's teams via abbrev / region / full name.
async function resolveCoachToTeam(leagueData, coachName) {
  if (!coachName || !leagueData?.teams) return null;
  const index = await loadCoachIndex();
  const entry = index.get(normalize(coachName));
  if (!entry) return null;

  const teamStr = normalize(entry.team);
  if (!teamStr) return null;

  const activeTeams = leagueData.teams.filter((t) => !t.disabled);

  // Try abbrev exact, then region exact, then full name, then loose contains.
  for (const t of activeTeams) {
    if (normalize(t.abbrev) === teamStr) return t;
  }
  for (const t of activeTeams) {
    if (normalize(t.region) === teamStr) return t;
  }
  for (const t of activeTeams) {
    const full = normalize(`${t.region} ${t.name}`);
    if (full === teamStr) return t;
  }
  for (const t of activeTeams) {
    const aliases = [t.abbrev, t.region, t.name, `${t.region} ${t.name}`].map(
      normalize
    );
    if (
      aliases.some((a) => a && (a === teamStr || a.includes(teamStr) || teamStr.includes(a)))
    ) {
      return t;
    }
  }
  return null;
}

// Convenience: from a Discord interaction-style user, return their FM team.
async function getUserTeam(leagueData, userId) {
  const coachName = getUserCoachName(userId);
  if (!coachName) return null;
  return resolveCoachToTeam(leagueData, coachName);
}

// Convenience: from a Discord user, return { coachName, team }.
async function getUserCoachAndTeam(leagueData, userId) {
  const coachName = getUserCoachName(userId);
  if (!coachName) return { coachName: null, team: null };
  const team = await resolveCoachToTeam(leagueData, coachName);
  return { coachName, team };
}

module.exports = {
  getUserCoachName,
  setUserCoach,
  clearUserCoach,
  loadCoachIndex,
  resolveCoachToTeam,
  getUserTeam,
  getUserCoachAndTeam,
  STORE_PATH,
};
