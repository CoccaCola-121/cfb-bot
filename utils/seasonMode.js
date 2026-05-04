// ============================================================
//  utils/seasonMode.js
//
//  Single source of truth for whether the bot is in "live" mode
//  (current-season data sourced from the Football GM JSON export)
//  or "offseason" mode (data sourced from the league sheets, since
//  the export goes stale during the ~40-day offseason).
//
//  Mode precedence (highest wins):
//    1. Env var:  NZCFL_SEASON_MODE = live | offseason | auto
//    2. State file written by /seasonmode admin command
//    3. Default: 'live'
//
//  'auto' is resolved at call time from leagueData.gameAttributes.phase.
//  Phases 0–3 (preseason / regular / after-regular / playoffs+natty)
//  are treated as live; anything past playoffs is offseason.
// ============================================================

const fs = require('fs');
const path = require('path');

const DATA_DIR =
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  process.env.DATA_DIR ||
  path.join(__dirname, '..', 'data');

const STATE_FILE = path.join(DATA_DIR, 'season_mode.json');

const VALID_RAW = new Set(['live', 'offseason', 'auto']);
const VALID_RESOLVED = new Set(['live', 'offseason']);

// Football GM / zengm phases. Anything ≤ PLAYOFFS is "live" — the natty
// is part of the playoff phase, so we stay in live until the commish
// actually advances past it. Anything later is offseason.
const PHASE_PRESEASON           = 0;
const PHASE_REGULAR_SEASON      = 1;
const PHASE_AFTER_REGULAR       = 2;
const PHASE_PLAYOFFS            = 3;
const LIVE_PHASE_MAX = PHASE_PLAYOFFS;

function normalizeRaw(value) {
  const v = String(value || '').toLowerCase().trim();
  return VALID_RAW.has(v) ? v : null;
}

function readStateFile() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const text = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    return normalizeRaw(parsed?.mode) ? parsed : null;
  } catch (err) {
    console.error('seasonMode: failed to read state file:', err);
    return null;
  }
}

function writeStateFile(mode, actor = null) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const payload = {
    mode,
    setAt: new Date().toISOString(),
    setBy: actor || null,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * Returns the configured (raw) mode, *not* resolved through 'auto'.
 *   'live' | 'offseason' | 'auto'
 *
 * Source precedence: env var → state file → 'live'.
 */
function getRawMode() {
  const env = normalizeRaw(process.env.NZCFL_SEASON_MODE);
  if (env) return env;

  const state = readStateFile();
  if (state && normalizeRaw(state.mode)) return normalizeRaw(state.mode);

  return 'live';
}

/**
 * Map an FGM phase number to a resolved mode.
 *   phase ≤ PLAYOFFS  →  'live'
 *   phase >  PLAYOFFS →  'offseason'
 *   unknown phase     →  'live' (safe default)
 */
function inferModeFromPhase(phase) {
  const p = Number(phase);
  if (!Number.isFinite(p)) return 'live';
  return p <= LIVE_PHASE_MAX ? 'live' : 'offseason';
}

function readPhase(leagueData) {
  return leagueData?.gameAttributes?.phase ?? null;
}

/**
 * Returns the resolved mode for the bot to act on:
 *   'live' | 'offseason'
 *
 * If raw mode is 'auto', leagueData is consulted to read the FGM
 * phase. Pass leagueData when you have it; if you don't, 'auto'
 * falls back to 'live' (safer default — never falsely show stale
 * sheet data during a live week).
 */
function getSeasonMode(leagueData = null) {
  const raw = getRawMode();
  if (raw === 'live' || raw === 'offseason') return raw;

  // raw === 'auto'
  const phase = readPhase(leagueData);
  if (phase === null) return 'live';
  return inferModeFromPhase(phase);
}

function isOffseason(leagueData = null) {
  return getSeasonMode(leagueData) === 'offseason';
}

function isLive(leagueData = null) {
  return getSeasonMode(leagueData) === 'live';
}

/**
 * Persist a new mode. Caller is responsible for permission gating.
 * Returns the metadata block that was written.
 */
function setSeasonMode(mode, actor = null) {
  const normalized = normalizeRaw(mode);
  if (!normalized) {
    throw new Error(
      `Invalid season mode '${mode}'. Use one of: live, offseason, auto.`
    );
  }
  return writeStateFile(normalized, actor);
}

/**
 * Diagnostic snapshot for /seasonmode status.
 */
function getModeStatus(leagueData = null) {
  const envValue = normalizeRaw(process.env.NZCFL_SEASON_MODE) || null;
  const state = readStateFile();
  const raw = getRawMode();
  const resolved = getSeasonMode(leagueData);
  const phase = readPhase(leagueData);

  return {
    resolved,
    raw,
    envValue,
    stateFileMode: state?.mode || null,
    stateSetAt: state?.setAt || null,
    stateSetBy: state?.setBy || null,
    phase,
    phaseImpliesMode: phase === null ? null : inferModeFromPhase(phase),
    statePath: STATE_FILE,
  };
}

module.exports = {
  getSeasonMode,
  getRawMode,
  setSeasonMode,
  isOffseason,
  isLive,
  inferModeFromPhase,
  getModeStatus,
  // Exposed for tests / future migrations.
  STATE_FILE,
  LIVE_PHASE_MAX,
};
