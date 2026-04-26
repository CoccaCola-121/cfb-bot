// ============================================================
//  utils/coachOverrides.js
//
//  Per-coach, per-year W/L overrides. A coach who only coached
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
//          "ties": 0,
//          "setBy": "<discord user id>",
//          "setAt": "<ISO timestamp>"
//        }
//      }
//    }
//  Coach names are stored verbatim but matched via normalize().
// ============================================================

const fs = require('fs');
const path = require('path');
const { normalize } = require('./sheets');

const DATA_DIR =
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  process.env.DATA_DIR ||
  path.join(__dirname, '..', 'data');

const STORE_PATH = path.join(DATA_DIR, 'coach_overrides.json');

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
  const target = normalize(coachName);
  for (const k of Object.keys(store)) {
    if (normalize(k) === target) return k;
  }
  return null;
}

// Return Map<yearString, { wins, losses, ties }> for a coach (empty Map if none).
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
      ties: Number(rec.ties) || 0,
      setBy: rec.setBy || null,
      setAt: rec.setAt || null,
    });
  }
  return out;
}

function setCoachOverride(coachName, year, wins, losses, ties, userId) {
  if (!coachName || !year) return false;
  const yearStr = String(year);
  const w = Math.max(0, Math.floor(Number(wins) || 0));
  const l = Math.max(0, Math.floor(Number(losses) || 0));
  const t = Math.max(0, Math.floor(Number(ties) || 0));

  const store = loadStore();
  const existingKey = findStoreKey(store, coachName);
  const key = existingKey || coachName;

  if (!store[key]) store[key] = {};
  store[key][yearStr] = {
    wins: w,
    losses: l,
    ties: t,
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
  const m = String(rec).match(/^\s*(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?\s*$/);
  if (!m) return null;
  return {
    wins: parseInt(m[1], 10) || 0,
    losses: parseInt(m[2], 10) || 0,
    ties: m[3] ? parseInt(m[3], 10) || 0 : 0,
  };
}

function formatRecord(w, l, t) {
  return Number(t) > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

// Apply this coach's overrides on top of a parsed-resume object of shape:
//   { record: "120-30", wins, losses, pct, history: [{ year, record, team }, ...] }
//
// Behavior per overridden year:
//   • If history has an existing record for that year, subtract its W/L from
//     the totals before adding the override.
//   • If history has no record for that year, just add the override (treated
//     as a brand-new partial-season entry; team comes from existing history
//     entry if any, otherwise null).
//   • The history entry is replaced/inserted with the override record.
//
// Returns a new resume-shaped object (does not mutate the input).
function applyOverridesToResume(resume, coachName) {
  if (!resume) return resume;
  const overrides = getOverridesForCoach(coachName);
  if (overrides.size === 0) return resume;

  let totalW = Number(resume.wins) || 0;
  let totalL = Number(resume.losses) || 0;
  // resume.history entries don't normally carry ties, but support them anyway.
  let totalT = 0;

  const historyByYear = new Map();
  for (const h of resume.history || []) {
    if (h && h.year != null) historyByYear.set(String(h.year), { ...h });
  }

  for (const [year, ov] of overrides.entries()) {
    const existing = historyByYear.get(year);
    if (existing && existing.record) {
      const parsed = parseRecordToWL(existing.record);
      if (parsed) {
        totalW -= parsed.wins;
        totalL -= parsed.losses;
        totalT -= parsed.ties || 0;
      }
    }
    totalW += ov.wins;
    totalL += ov.losses;
    totalT += ov.ties;

    const newRecordStr = formatRecord(ov.wins, ov.losses, ov.ties);
    historyByYear.set(year, {
      year,
      record: newRecordStr,
      team: existing?.team || null,
      overridden: true,
    });
  }

  // Defensive: don't allow negative totals from bad data.
  if (totalW < 0) totalW = 0;
  if (totalL < 0) totalL = 0;
  if (totalT < 0) totalT = 0;

  const games = totalW + totalL + totalT;
  const totalRecord = formatRecord(totalW, totalL, totalT);

  const newHistory = [...historyByYear.values()].sort(
    (a, b) => Number(a.year) - Number(b.year)
  );

  return {
    ...resume,
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
  if (!record) return record;
  const overrides = getOverridesForCoach(coachName);
  if (overrides.size === 0) return record;

  let totalW = Number(record.wins) || 0;
  let totalL = Number(record.losses) || 0;

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
    ...record,
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
