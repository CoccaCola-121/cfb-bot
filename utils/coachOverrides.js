// ============================================================
//  utils/coachOverrides.js
//
//  Per-coach, per-year W/L/team overrides. A coach who only coached
//  part of a season (mid-season hire, mid-season departure, etc.)
//  can use /recordupdate to set the W-L they actually own for a
//  given year. Those overrides hard-overwrite the corresponding
//  history entry in their resume and re-derive the career total.
//
//  Storage shape (data/coach_overrides.json):
//    {
//      "Bob Smith": {
//        "2058": {
//          "wins": 5,
//          "losses": 3,
//          "team": "West Virginia",
//          "setBy": "<discord user id>",
//          "setAt": "<ISO timestamp>"
//        }
//      }
//    }
//  Coach names are stored verbatim but matched via normalize().
//  No ties — modern college football has overtime, every game has a winner.
// ============================================================

const fs = require('fs');
const path = require('path');
const { normalize } = require('./sheets');

const DATA_DIR =
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  process.env.DATA_DIR ||
  path.join(__dirname, '..', 'data');

const STORE_PATH = path.join(DATA_DIR, 'coach_overrides.json');

function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const dp = Array.from({ length: s.length + 1 }, () => new Array(t.length + 1).fill(0));

  for (let i = 0; i <= s.length; i++) dp[i][0] = i;
  for (let j = 0; j <= t.length; j++) dp[0][j] = j;

  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[s.length][t.length];
}

function coachKeysLikelyMatch(a, b) {
  const an = normalize(a);
  const bn = normalize(b);
  if (!an || !bn) return false;
  if (an === bn) return true;
  if (an.length >= 4 && bn.length >= 4 && (an.includes(bn) || bn.includes(an))) return true;
  return Math.max(an.length, bn.length) >= 8 && levenshtein(an, bn) <= 2;
}

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
    console.error('[coachOverrides] saveStore failed:', err.message);
    return false;
  }
}

// Find the canonical key for a coach in the store using normalize() match.
// Returns the existing key if any, otherwise null.
function findStoreKey(store, coachName) {
  if (!coachName) return null;
  for (const k of Object.keys(store)) {
    if (coachKeysLikelyMatch(k, coachName)) return k;
  }
  return null;
}

// Return Map<yearString, { wins, losses, team, setBy, setAt }> for a coach
// (empty Map if none).
function getOverridesForCoach(coachName) {
  const out = new Map();
  if (!coachName) return out;
  const store = loadStore();
  const key = findStoreKey(store, coachName);
  if (!key) return out;
  const entries = store[key] || {};
  for (const [year, rec] of Object.entries(entries)) {
    if (!rec) continue;
    out.set(String(year), {
      wins: Number(rec.wins) || 0,
      losses: Number(rec.losses) || 0,
      team: rec.team ? String(rec.team).trim() : null,
      setBy: rec.setBy || null,
      setAt: rec.setAt || null,
    });
  }
  return out;
}

function setCoachOverride(coachName, year, wins, losses, userId, team = null) {
  if (!coachName || !year) return false;
  const yearStr = String(year);
  const w = Math.max(0, Math.floor(Number(wins) || 0));
  const l = Math.max(0, Math.floor(Number(losses) || 0));
  const cleanTeam = team ? String(team).trim() : null;

  const store = loadStore();
  const existingKey = findStoreKey(store, coachName);
  const key = existingKey || coachName;

  if (!store[key]) store[key] = {};
  store[key][yearStr] = {
    wins: w,
    losses: l,
    team: cleanTeam || null,
    setBy: userId ? String(userId) : null,
    setAt: new Date().toISOString(),
  };

  return saveStore(store);
}

// Clear one year (if year provided) or all overrides for the coach.
// Returns true if anything was removed.
function clearCoachOverride(coachName, year = null) {
  if (!coachName) return false;
  const store = loadStore();
  const key = findStoreKey(store, coachName);
  if (!key || !store[key]) return false;

  if (year === null || year === undefined) {
    delete store[key];
    return saveStore(store);
  }

  const yearStr = String(year);
  if (!(yearStr in store[key])) return false;
  delete store[key][yearStr];
  // Remove the coach's entry entirely if it has no more years.
  if (Object.keys(store[key]).length === 0) delete store[key];
  return saveStore(store);
}

function parseRecordToWL(rec) {
  if (!rec) return null;
  // Tolerate a trailing tie segment in legacy data, but discard it —
  // modern CFB has no ties.
  const m = String(rec).match(/^\s*(\d+)\s*-\s*(\d+)(?:\s*-\s*\d+)?\s*$/);
  if (!m) return null;
  return {
    wins: parseInt(m[1], 10) || 0,
    losses: parseInt(m[2], 10) || 0,
  };
}

function formatRecord(w, l) {
  return `${w}-${l}`;
}

// Apply this coach's overrides on top of a parsed-resume object of shape:
//   { record: "120-30", wins, losses, pct, history: [{ year, record, team }, ...] }
//
// Behavior per overridden year:
//   • If history has an existing record for that year, subtract its W/L from
//     the totals before adding the override.
//   • If history has no record for that year, just add the override (treated
//     as a brand-new partial-season entry; team comes from the override,
//     existing history entry if any, otherwise null).
//   • The history entry is replaced/inserted with the override record.
//
// Returns a new resume-shaped object (does not mutate the input).
function applyOverridesToResume(resume, coachName, defaultTeam = null) {
  const overrides = getOverridesForCoach(coachName);
  if (overrides.size === 0) return resume;

  const baseResume = resume || {
    record: '0-0',
    wins: 0,
    losses: 0,
    pct: 0,
    history: [],
  };

  let totalW = Number(baseResume.wins) || 0;
  let totalL = Number(baseResume.losses) || 0;

  const historyByYear = new Map();
  for (const h of baseResume.history || []) {
    if (h && h.year != null) historyByYear.set(String(h.year), { ...h });
  }

  for (const [year, ov] of overrides.entries()) {
    const existing = historyByYear.get(year);
    if (existing && existing.record) {
      const parsed = parseRecordToWL(existing.record);
      if (parsed) {
        totalW -= parsed.wins;
        totalL -= parsed.losses;
      }
    }
    totalW += ov.wins;
    totalL += ov.losses;

    const newRecordStr = formatRecord(ov.wins, ov.losses);
    historyByYear.set(year, {
      year,
      record: newRecordStr,
      team: ov.team || existing?.team || defaultTeam || null,
      overridden: true,
    });
  }

  // Defensive: don't allow negative totals from bad data.
  if (totalW < 0) totalW = 0;
  if (totalL < 0) totalL = 0;

  const games = totalW + totalL;
  const totalRecord = formatRecord(totalW, totalL);

  const newHistory = [...historyByYear.values()].sort(
    (a, b) => Number(a.year) - Number(b.year)
  );

  return {
    ...baseResume,
    wins: totalW,
    losses: totalL,
    pct: games > 0 ? totalW / games : 0,
    record: totalRecord,
    history: newHistory,
    hasOverrides: true,
  };
}

// Convenience for the leaderboard, which doesn't have a `history` array but
// does have { wins, losses, pct, record }. We rebuild a minimal "history"
// from the resume sheet history if available; otherwise we just adjust totals
// by treating each override as additive (which is the only thing we can do
// without knowing what the original year contributed).
function applyOverridesToLeaderboardRecord(record, coachName, fullHistory = null) {
  const overrides = getOverridesForCoach(coachName);
  if (overrides.size === 0) return record;

  const baseRecord = record || {
    wins: 0,
    losses: 0,
    pct: 0,
    record: '0-0',
  };

  let totalW = Number(baseRecord.wins) || 0;
  let totalL = Number(baseRecord.losses) || 0;

  if (Array.isArray(fullHistory) && fullHistory.length) {
    for (const [year, ov] of overrides.entries()) {
      const existing = fullHistory.find((h) => String(h.year) === year);
      if (existing && existing.record) {
        const parsed = parseRecordToWL(existing.record);
        if (parsed) {
          totalW -= parsed.wins;
          totalL -= parsed.losses;
        }
      }
      totalW += ov.wins;
      totalL += ov.losses;
    }
  } else {
    // No history available — best-effort: treat overrides as additive only
    // (they replace nothing because we don't know the original).
    for (const ov of overrides.values()) {
      totalW += ov.wins;
      totalL += ov.losses;
    }
  }

  if (totalW < 0) totalW = 0;
  if (totalL < 0) totalL = 0;

  const games = totalW + totalL;
  return {
    ...baseRecord,
    wins: totalW,
    losses: totalL,
    pct: games > 0 ? totalW / games : 0,
    record: `${totalW}-${totalL}`,
    hasOverrides: true,
  };
}

module.exports = {
  STORE_PATH,
  getOverridesForCoach,
  setCoachOverride,
  clearCoachOverride,
  applyOverridesToResume,
  applyOverridesToLeaderboardRecord,
};
