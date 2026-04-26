// ============================================================
//  utils/sheetCache.js
//
//  Tiny in-memory TTL cache around fetchSheetCsv. Several commands
//  hit the same sheet on every invocation (coach CSV is hit by
//  /coachstats, /coachleaderboard, /openpositions, /teamhistory,
//  /championships, /dynastytracker, …). This avoids re-downloading +
//  re-parsing on each call without changing call sites — they just
//  swap `fetchSheetCsv` for `fetchSheetCsvCached`.
//
//  TTL defaults to 5 minutes, configurable via SHEET_CACHE_TTL_MS env.
//  Expose `invalidateSheetCache()` for /reloadcache or /loadweek hooks.
// ============================================================

const { fetchSheetCsv } = require('./sheets');

const DEFAULT_TTL_MS = Number(process.env.SHEET_CACHE_TTL_MS) || 5 * 60 * 1000;

// Map<cacheKey, { rows, expiresAt, inflight }>
const _cache = new Map();

function cacheKey(sheetId, tabIdentifier, byGid) {
  return `${sheetId}::${byGid ? 'gid' : 'tab'}::${tabIdentifier}`;
}

async function fetchSheetCsvCached(sheetId, tabIdentifier, byGid = false, ttlMs = DEFAULT_TTL_MS) {
  const key = cacheKey(sheetId, tabIdentifier, byGid);
  const now = Date.now();
  const hit = _cache.get(key);

  if (hit && hit.rows && hit.expiresAt > now) {
    return hit.rows;
  }

  // Coalesce concurrent requests so we don't hit the sheet N times in
  // parallel for the same key.
  if (hit && hit.inflight) return hit.inflight;

  const inflight = (async () => {
    try {
      const rows = await fetchSheetCsv(sheetId, tabIdentifier, byGid);
      _cache.set(key, { rows, expiresAt: Date.now() + ttlMs, inflight: null });
      return rows;
    } catch (err) {
      // Don't poison the cache; let the next caller retry.
      _cache.delete(key);
      throw err;
    }
  })();

  _cache.set(key, {
    rows: hit?.rows || null,
    expiresAt: hit?.expiresAt || 0,
    inflight,
  });

  return inflight;
}

function invalidateSheetCache(sheetId = null, tabIdentifier = null, byGid = false) {
  if (sheetId === null) {
    _cache.clear();
    return;
  }
  if (tabIdentifier === null) {
    // Invalidate every tab on this sheet.
    for (const k of [..._cache.keys()]) {
      if (k.startsWith(`${sheetId}::`)) _cache.delete(k);
    }
    return;
  }
  _cache.delete(cacheKey(sheetId, tabIdentifier, byGid));
}

function sheetCacheStats() {
  const now = Date.now();
  return [..._cache.entries()].map(([key, v]) => ({
    key,
    cached: !!v.rows,
    rows: v.rows ? v.rows.length : 0,
    expiresInMs: v.expiresAt > now ? v.expiresAt - now : 0,
    inflight: !!v.inflight,
  }));
}

module.exports = {
  fetchSheetCsvCached,
  invalidateSheetCache,
  sheetCacheStats,
  DEFAULT_TTL_MS,
};
