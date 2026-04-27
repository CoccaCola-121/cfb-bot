  // ============================================================
  //  utils/data.js
  // ============================================================

  const fs = require('fs');
  const path = require('path');
  const zlib = require('zlib');
  const { REG_SEASON_WEEKS } = require('./weekLabels');

  const fetchFn = globalThis.fetch
    ? globalThis.fetch.bind(globalThis)
    : require('node-fetch');

  // Prefer Railway mounted volume if available.
  // Fallback to DATA_DIR, then local ./data for dev.
  const DATA_DIR =
    process.env.RAILWAY_VOLUME_MOUNT_PATH ||
    process.env.DATA_DIR ||
    path.join(__dirname, '..', 'data');

  console.log('DATA_DIR =', DATA_DIR);
  console.log('RAILWAY_VOLUME_MOUNT_PATH =', process.env.RAILWAY_VOLUME_MOUNT_PATH || '(not set)');
  console.log('DATA_DIR exists =', fs.existsSync(DATA_DIR));

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const MAX_SAVED_FILES = 2;

  // Only files matching this pattern are treated as league exports. This keeps
  // other persisted state files (e.g. user_coaches.json) out of
  // getLatestLeagueData and pruneOldLeagueFiles. Without this, updating any
  // such state file would (a) make the bot try to read it as league data and
  // (b) push the real league file out of the "2 newest" prune window.
  const LEAGUE_FILE_RE = /^league_.*\.json(\.gz)?$/i;

  function isLeagueFile(name) {
    return LEAGUE_FILE_RE.test(name);
  }

  // ── Custom logo overrides ────────────────────────────────────

  const TEAM_LOGO_OVERRIDES = new Map([
    ['Air Force', 'https://images2.imgbox.com/c7/bb/xDLitf07_o.png'],
    ['Akron', 'https://images2.imgbox.com/89/ea/mMD6Ccm7_o.png'],
    ['Alabama', 'https://images2.imgbox.com/9a/43/y0wKYsVs_o.png'],
    ['Alabama-Birmingham', 'https://images2.imgbox.com/ed/0f/QTH7XyHw_o.png'],
    ['Appalachian State', 'https://images2.imgbox.com/75/a0/tT1K8QoN_o.png'],
    ['Arizona', 'https://images2.imgbox.com/8a/a3/733Dg3ZS_o.png'],
    ['Arizona State', 'https://images2.imgbox.com/0c/00/7qmdQVQ3_o.png'],
    ['Arkansas', 'https://images2.imgbox.com/03/10/wDSYdron_o.png'],
    ['Arkansas State', 'https://images2.imgbox.com/f6/28/PDv2Luh7_o.png'],
    ['Army', 'https://images2.imgbox.com/5b/97/smrhRDlI_o.png'],
    ['Auburn', 'https://images2.imgbox.com/81/79/oDSSMINc_o.png'],
    ['Ball State', 'https://images2.imgbox.com/dc/40/7UKGhcy9_o.png'],
    ['Baylor', 'https://images2.imgbox.com/92/cb/JpIO0G3W_o.png'],
    ['Boise State', 'https://images2.imgbox.com/01/72/PUZ2EdFp_o.png'],
    ['Boston College', 'https://images2.imgbox.com/5d/c7/P5baVIQL_o.png'],
    ['Bowling Green', 'https://images2.imgbox.com/7a/58/Bvz8adoE_o.png'],
    ['Brigham Young', 'https://images2.imgbox.com/fe/00/7cRQIBy3_o.png'],
    ['Buffalo', 'https://images2.imgbox.com/da/56/3Lm4bqKc_o.png'],
    ['California', 'https://images2.imgbox.com/ae/da/NfYEWvyN_o.png'],
    ['Central Florida', 'https://images2.imgbox.com/45/95/t0KwMcbS_o.png'],
    ['Central Michigan', 'https://images2.imgbox.com/f0/a6/ngU6ibhI_o.png'],
    ['Charlotte', 'https://images2.imgbox.com/11/ec/32o9zZ92_o.png'],
    ['Cincinnati', 'https://images2.imgbox.com/c9/12/StvXRphT_o.png'],
    ['Clemson', 'https://images2.imgbox.com/42/cb/vMu3nQ3q_o.png'],
    ['Coastal Carolina', 'https://images2.imgbox.com/e9/b6/lAYs2wd1_o.png'],
    ['Colorado', 'https://images2.imgbox.com/22/66/fee9OYHM_o.png'],
    ['Colorado State', 'https://images2.imgbox.com/8a/08/TdVDROMl_o.png'],
    ['Delaware', 'https://livinghuman.host/espn_logos/512png/Delaware.png'],
    ['Duke', 'https://images2.imgbox.com/63/49/i1kzNMx6_o.png'],
    ['East Carolina', 'https://images2.imgbox.com/0e/c5/B7IXDoRt_o.png'],
    ['Eastern Michigan', 'https://images2.imgbox.com/b4/54/ePL3CVRg_o.png'],
    ['FIU', 'https://images2.imgbox.com/79/b5/Je4EZArK_o.png'],
    ['Florida', 'https://images2.imgbox.com/7a/d7/oCvxB8en_o.png'],
    ['Florida Atlantic', 'https://images2.imgbox.com/18/39/pkFPOKfZ_o.png'],
    ['Florida State', 'https://images2.imgbox.com/46/e0/27cTAzlt_o.png'],
    ['Fresno State', 'https://images2.imgbox.com/67/31/Yf8CfhGd_o.png'],
    ['Georgetown', 'http://a.espncdn.com/i/teamlogos/ncaa/500/46.png'],
    ['Georgia', 'https://images2.imgbox.com/58/f7/IURgoJvv_o.png'],
    ['Georgia Southern', 'https://images2.imgbox.com/59/4b/r1KYIIdL_o.png'],
    ['Georgia State', 'https://images2.imgbox.com/3b/a2/TP1fCq3f_o.png'],
    ['Georgia Tech', 'https://images2.imgbox.com/5c/59/fbH9LVz3_o.png'],
    ['Grambling State', 'https://livinghuman.host/espn_logos/512png/Grambling%20State.png'],
    ['Harvard', 'http://a.espncdn.com/i/teamlogos/ncaa/500/108.png'],
    ['Hawaii', 'https://images2.imgbox.com/72/2b/KtapOHOq_o.png'],
    ['Houston', 'https://images2.imgbox.com/95/e1/ZmvjlNOf_o.png'],
    ['Illinois', 'https://images2.imgbox.com/d3/be/lkzdF3Iy_o.png'],
    ['Indiana', 'https://images2.imgbox.com/7a/29/ORfcHDSB_o.png'],
    ['Iowa', 'https://images2.imgbox.com/6b/dd/KK5bnYuQ_o.png'],
    ['Iowa State', 'https://images2.imgbox.com/f1/1c/AP4Np6t0_o.png'],
    ['James Madison', 'https://images2.imgbox.com/f5/b5/d8TUHBvZ_o.png'],
    ['Kansas', 'https://images2.imgbox.com/da/1b/3GeOge4i_o.png'],
    ['Kansas State', 'https://images2.imgbox.com/48/0d/S6nhVmim_o.png'],
    ['Kent State', 'https://images2.imgbox.com/44/b2/FtZ8ZW4N_o.png'],
    ['Kentucky', 'https://images2.imgbox.com/7d/34/qTspeeFk_o.png'],
    ['Louisiana', 'https://images2.imgbox.com/63/3d/BZki3zH6_o.png'],
    ['Louisiana State', 'https://images2.imgbox.com/b6/7e/hCaBjAbR_o.png'],
    ['Louisiana Tech', 'https://images2.imgbox.com/92/2a/f7F86w4n_o.png'],
    ['Louisville', 'https://images2.imgbox.com/c3/2f/BABH4w6l_o.png'],
    ['LSU', 'https://images2.imgbox.com/b6/7e/hCaBjAbR_o.png'],
    ['Marshall', 'https://images2.imgbox.com/80/43/7t5XZZSE_o.png'],
    ['Maryland', 'https://images2.imgbox.com/d6/fb/tO5DpQME_o.png'],
    ['Memphis', 'https://images2.imgbox.com/14/bd/hFg8QXoq_o.png'],
    ['Miami', 'https://images2.imgbox.com/54/bd/7iNp1lgo_o.png'],
    ['Miami (OH)', 'https://images2.imgbox.com/2d/54/myzJs5XC_o.png'],
    ['Michigan', 'https://images2.imgbox.com/01/e6/I61xpk56_o.png'],
    ['Michigan State', 'https://images2.imgbox.com/7c/8f/DJkk8wcG_o.png'],
    ['Mid Tenn State', 'https://images2.imgbox.com/08/7c/BuplWvHb_o.png'],
    ['Minnesota', 'https://images2.imgbox.com/22/d8/WU1UZFfP_o.png'],
    ['Mississippi State', 'https://images2.imgbox.com/95/3e/qVeRpH5o_o.png'],
    ['Missouri', 'https://images2.imgbox.com/47/f2/qB5KOgmk_o.png'],
    ['Montana', 'https://livinghuman.host/espn_logos/512png/Montana.png'],
    ['Montana State', 'https://livinghuman.host/espn_logos/512png/Montana%20State.png'],
    ['Navy', 'https://images2.imgbox.com/da/bc/iOxwLhSW_o.png'],
    ['Nebraska', 'https://images2.imgbox.com/4c/b2/vUA8crA7_o.png'],
    ['Nevada', 'https://images2.imgbox.com/37/46/4eP7M4cT_o.png'],
    ['New Mexico', 'https://images2.imgbox.com/02/a0/QTnwhEMP_o.png'],
    ['North Carolina', 'https://images2.imgbox.com/6e/4f/wRpHwzed_o.png'],
    ['North Carolina State', 'https://images2.imgbox.com/77/71/q0mGgNXb_o.png'],
    ['North Dakota State', 'https://livinghuman.host/espn_logos/512png/North%20Dakota%20State.png'],
    ['North Texas', 'https://images2.imgbox.com/82/db/QhMEU8L3_o.png'],
    ['Northern Illinois', 'https://images2.imgbox.com/b4/c9/yAL01o2g_o.png'],
    ['Northwestern', 'https://images2.imgbox.com/8c/8e/KmbegBQV_o.png'],
    ['Notre Dame', 'https://images2.imgbox.com/4a/1e/DmiyULZm_o.png'],
    ['Ohio', 'https://images2.imgbox.com/ac/97/vvt0VjWE_o.png'],
    ['Ohio State', 'https://images2.imgbox.com/a4/f1/Zktd18n0_o.png'],
    ['Oklahoma', 'https://images2.imgbox.com/f8/58/4RP90Mby_o.png'],
    ['Oklahoma State', 'https://images2.imgbox.com/e2/ea/35oHtkU4_o.png'],
    ['Old Dominion', 'https://images2.imgbox.com/58/45/RO6nn4Mj_o.png'],
    ['Ole Miss', 'https://images2.imgbox.com/4c/4d/RIIarcGd_o.png'],
    ['Oregon', 'https://images2.imgbox.com/56/a0/eF6Qqwny_o.png'],
    ['Oregon State', 'https://images2.imgbox.com/fe/1b/GUe267uV_o.png'],
    ['Penn State', 'https://images2.imgbox.com/9b/cb/Z8DxS0KK_o.png'],
    ['Pittsburgh', 'https://images2.imgbox.com/e3/ec/GI0HHlE8_o.png'],
    ['Princeton', 'https://images2.imgbox.com/08/31/0TwHmJ7A_o.png'],
    ['Purdue', 'https://images2.imgbox.com/4a/12/AlmXF8Js_o.png'],
    ['Rice', 'https://images2.imgbox.com/1a/ee/GsZ8GY47_o.png'],
    ['RPI', 'https://images2.imgbox.com/8d/a6/usZGznnS_o.png'],
    ['Rutgers', 'https://images2.imgbox.com/68/a8/dXsbLpzW_o.png'],
    ['San Diego State', 'https://images2.imgbox.com/a9/c1/gvvIBk4j_o.png'],
    ['San Jose State', 'https://images2.imgbox.com/a1/39/sXs9OcIH_o.png'],
    ['South Alabama', 'https://images2.imgbox.com/2e/85/T1Z1hV83_o.png'],
    ['South Carolina', 'https://images2.imgbox.com/74/d2/o593n2Jb_o.png'],
    ['South Dakota State', 'https://livinghuman.host/espn_logos/512png/South%20Dakota%20State.png'],
    ['South Florida', 'https://images2.imgbox.com/80/5d/5hM1CaKi_o.png'],
    ['Southern Methodist', 'https://images2.imgbox.com/ae/b8/ls2wX3zD_o.png'],
    ['Southern Mississippi', 'https://images2.imgbox.com/d1/d2/6kzJbi35_o.png'],
    ['Stanford', 'https://images2.imgbox.com/23/a1/zvMbu946_o.png'],
    ['Syracuse', 'https://images2.imgbox.com/42/60/X251QD4R_o.png'],
    ['Temple', 'https://images2.imgbox.com/da/22/PYaRTLYi_o.png'],
    ['Tennessee', 'https://images2.imgbox.com/74/e6/3hbNc7Mc_o.png'],
    ['Texas', 'https://images2.imgbox.com/43/1b/a9PT0YD6_o.png'],
    ['Texas A&M', 'https://images2.imgbox.com/4d/93/9SChzxxz_o.png'],
    ['Texas Christian', 'https://images2.imgbox.com/ae/40/zHtZWsg3_o.png'],
    ['Texas State', 'https://images2.imgbox.com/10/3d/IiF1TKdt_o.png'],
    ['Texas Tech', 'https://images2.imgbox.com/f4/75/lMdrk3Jl_o.png'],
    ['Toledo', 'https://images2.imgbox.com/90/c1/9dc7GSFi_o.png'],
    ['Troy', 'https://images2.imgbox.com/d3/ca/YlxzIhbr_o.png'],
    ['Tulane', 'https://images2.imgbox.com/ca/15/WgLbNZab_o.png'],
    ['Tulsa', 'https://images2.imgbox.com/98/e5/POZ2N5e7_o.png'],
    ['UCLA', 'https://images2.imgbox.com/3c/9f/MlYOTNQz_o.png'],
    ['UCONN', 'https://livinghuman.host/espn_logos/512png/UCONN.png'],
    ['ULM', 'https://images2.imgbox.com/b0/6a/AOzeMaor_o.png'],
    ['UNLV', 'https://images2.imgbox.com/0d/f3/fAcGkBzf_o.png'],
    ['USC', 'https://images2.imgbox.com/65/bd/iA9h3vig_o.png'],
    ['UTEP', 'https://images2.imgbox.com/6f/7a/YGy2l137_o.png'],
    ['UTSA', 'https://images2.imgbox.com/95/70/1PcVsEjg_o.png'],
    ['Utah', 'https://images2.imgbox.com/ce/24/z43qy7Nv_o.png'],
    ['Utah State', 'https://images2.imgbox.com/05/76/9RMJQGFl_o.png'],
    ['Vanderbilt', 'https://images2.imgbox.com/4e/1a/WANow0qd_o.png'],
    ['Virginia', 'https://images2.imgbox.com/bd/60/YT78W4y2_o.png'],
    ['Virginia Tech', 'https://images2.imgbox.com/82/04/aif29wLv_o.png'],
    ['Wake Forest', 'https://images2.imgbox.com/e0/68/n11JQjuk_o.png'],
    ['Washington', 'https://images2.imgbox.com/c8/87/GV0jFWwz_o.png'],
    ['Washington State', 'https://images2.imgbox.com/b4/0a/N7tI7RlE_o.png'],
    ['West Virginia', 'https://images2.imgbox.com/d4/9f/p9cnFvRr_o.png'],
    ['Western Kentucky', 'https://images2.imgbox.com/6a/7c/242rIOW2_o.png'],
    ['Western Michigan', 'https://images2.imgbox.com/b3/cc/X21bh3LR_o.png'],
    ['Wisconsin', 'https://images2.imgbox.com/6e/95/jlC5rgpV_o.png'],
    ['Wyoming', 'https://images2.imgbox.com/4b/87/NjciOuXP_o.png'],
    ['Yale', 'http://a.espncdn.com/i/teamlogos/ncaa/500/43.png'],
    ['Alaska-Anchorage', 'https://images2.imgbox.com/35/70/gCV9cgIU_o.png'],
  ]);

  const CONFERENCE_LOGO_OVERRIDES = new Map([
    ['ACC', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/ACC.png'],
    ['AAC', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/American.png'],
    ['B12', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/Big%20XII.png'],
    ['B1G', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/B1G.png'],
    ['C-USA', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/C-USA.png'],
    ['CUSA', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/C-USA.png'],
    ['Independents', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/Independents.png'],
    ['MAC', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/MAC.png'],
    ['MW', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/MWC.png'],
    ['P12', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/PAC%2012.png'],
    ['SEC', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/SEC.png'],
    ['SB', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/Sun%20Belt.png'],
    ['SUN', 'https://livinghuman.host/espn_logos/CustomLogos/Conferences/Sun%20Belt.png'],
  ]);

  function normalizeLogoKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]/g, '');
  }

  const NORMALIZED_TEAM_LOGO_OVERRIDES = new Map(
    [...TEAM_LOGO_OVERRIDES.entries()].map(([key, value]) => [normalizeLogoKey(key), value])
  );

  const NORMALIZED_CONFERENCE_LOGO_OVERRIDES = new Map(
    [...CONFERENCE_LOGO_OVERRIDES.entries()].map(([key, value]) => [normalizeLogoKey(key), value])
  );

  // ── File helpers ─────────────────────────────────────────────

  // In-memory cache for the parsed league JSON. We re-parse only when the
  // latest file's path or mtime changes — saves a 39 MB gunzip + JSON.parse
  // (~hundreds of ms) on every command invocation.
  let _leagueCache = { path: null, mtime: 0, data: null };

  function listLeagueFiles() {
    return fs.readdirSync(DATA_DIR)
      .filter(isLeagueFile)
      .map((f) => {
        const p = path.join(DATA_DIR, f);
        const st = fs.statSync(p);
        return { name: f, path: p, time: st.mtime.getTime(), size: st.size };
      })
      .sort((a, b) => b.time - a.time);
  }

  function getLatestLeagueData() {
    const files = listLeagueFiles();
    if (files.length === 0) return null;

    const latest = files[0];
    if (_leagueCache.data &&
        _leagueCache.path === latest.path &&
        _leagueCache.mtime === latest.time) {
      return _leagueCache.data;
    }

    try {
      let parsed;
      if (latest.name.endsWith('.json.gz')) {
        const buffer = fs.readFileSync(latest.path);
        const jsonText = zlib.gunzipSync(buffer).toString('utf8');
        parsed = JSON.parse(jsonText);
      } else {
        // Legacy .json support so old files still load
        parsed = JSON.parse(fs.readFileSync(latest.path, 'utf8'));
      }

      // Build & attach a normalized team-name index once per load. Used by
      // findTeamByName-style helpers in commands so they don't re-scan
      // teams[] on every lookup. Stored as a non-enumerable so it doesn't
      // bloat any future JSON.stringify of leagueData.
      if (parsed && Array.isArray(parsed.teams)) {
        const idx = new Map();
        for (const t of parsed.teams) {
          if (t.disabled) continue;
          const aliases = [
            getTeamName(t),
            t.region,
            t.name,
            t.abbrev,
          ].filter(Boolean);
          for (const a of aliases) {
            const k = String(a)
              .toLowerCase()
              .replace(/&/g, 'and')
              .replace(/[^a-z0-9]/g, '');
            if (k && !idx.has(k)) idx.set(k, t);
          }
        }
        Object.defineProperty(parsed, '__teamIndex', {
          value: idx, enumerable: false, writable: false, configurable: true,
        });
      }

      _leagueCache = { path: latest.path, mtime: latest.time, data: parsed };
      return parsed;
    } catch {
      return null;
    }
  }

  // Look up a team by region/name/abbrev/full-name. Uses the cached
  // normalized team index (built once per league load) for O(1) lookups.
  function findTeamByName(leagueData, query) {
    if (!leagueData || !leagueData.teams || !query) return null;
    const k = String(query)
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]/g, '');
    if (!k) return null;
    const idx = leagueData.__teamIndex;
    if (idx) return idx.get(k) || null;
    // Fallback: cache wasn't built (shouldn't happen), do a linear scan.
    return leagueData.teams.find(
      (t) => !t.disabled && (
        [getTeamName(t), t.region, t.name, t.abbrev]
          .filter(Boolean)
          .some((a) => String(a).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '') === k)
      )
    ) || null;
  }

  // Force-clear the in-memory cache (used by /loadweek and /reloadcache).
  function invalidateLeagueCache() {
    _leagueCache = { path: null, mtime: 0, data: null };
  }

  function pruneOldLeagueFiles() {
    const files = listLeagueFiles();
    const toDelete = files.slice(MAX_SAVED_FILES);
    for (const f of toDelete) {
      try { fs.unlinkSync(f.path); } catch {}
    }
  }

  function saveLeagueData(jsonString, label) {
    const safeLabel = String(label || Date.now()).replace(/[^\w-]+/g, '_');
    const filename = `league_${safeLabel}.json.gz`;
    const filePath = path.join(DATA_DIR, filename);

    const compressed = zlib.gzipSync(jsonString, { level: 9 });
    fs.writeFileSync(filePath, compressed);

    pruneOldLeagueFiles();
    invalidateLeagueCache();
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

  function getTeamByTid(leagueData, tid) {
    if (!leagueData?.teams || tid === null || tid === undefined) return null;

    const numericTid = Number(tid);
    const teamMap = getTeamMap(leagueData);

    if (Number.isFinite(numericTid) && teamMap.has(numericTid)) {
      return teamMap.get(numericTid);
    }

    if (teamMap.has(tid)) {
      return teamMap.get(tid);
    }

    return leagueData.teams.find((team) => Number(team?.tid) === numericTid) || null;
  }

  function getTeamNameByTid(leagueData, tid) {
    return getTeamName(getTeamByTid(leagueData, tid));
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
    if (
      normalized.includes('big ten') ||
      normalized.includes('big 10') ||
      normalized.includes('big10') ||
      normalized === 'b1g'
    ) return 'B1G';
    if (
      normalized.includes('big 12') ||
      normalized.includes('big12') ||
      normalized.includes('big twelve') ||
      normalized.includes('big xii') ||
      normalized === 'b12'
    ) return 'B12';

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
    if (normalized.includes('independent')) return 'Independents';

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
        return (
          name.includes('big ten') ||
          name.includes('big 10') ||
          name.includes('big10') ||
          name.includes('b1g')
        );
      }

      if (target === 'B12') {
        return (
          name.includes('big 12') ||
          name.includes('big12') ||
          name.includes('big twelve') ||
          name.includes('big xii') ||
          name.includes('b12')
        );
      }

      if (target === 'C-USA' || target === 'CUSA') {
        return name.includes('conference usa') || name.includes('c-usa') || name.includes('cusa');
      }

      if (target === 'SUN' || target === 'SB') {
        return name.includes('sun belt') || name === 'sun';
      }

      return name.includes(target.toLowerCase());
    });

    return found || null;
  }

  function getConferenceAbbrev(leagueData, cid) {
    return getConferenceAbbrevFromName(getConferenceName(leagueData, cid));
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

  function shouldIgnoreGame(game) {
    const day = Number(game?.day);

    // Football GM exports can include an all-star game on day 17.
    // We never want that mixed into NZCFL week-based reporting.
    if (day === 17 && !Boolean(game?.playoffs)) {
      return true;
    }

    return false;
  }

  function getGamesForCurrentSeason(leagueData) {
    const currentSeason = getCurrentSeason(leagueData);
    const games = Array.isArray(leagueData?.games) ? leagueData.games : [];
    const filtered = currentSeason === null
      ? games
      : games.filter((g) => g.season === currentSeason);

    return filtered.filter((g) => !shouldIgnoreGame(g));
  }

  function buildGameDayWeekMap(games) {
    const uniqueDays = new Set();

    for (const game of games || []) {
      const day = Number(game?.day);
      if (!Number.isFinite(day)) continue;
      uniqueDays.add(day);
    }

    const map = new Map();

    for (const day of [...uniqueDays].sort((a, b) => a - b)) {
      let normalizedWeek = day;
      if (day > 17) normalizedWeek = day - 1;
      map.set(day, normalizedWeek);
    }

    return map;
  }

  function getCurrentSeasonWeekMap(leagueData) {
    return buildGameDayWeekMap(getGamesForCurrentSeason(leagueData));
  }

  function inferWeekFromGameDay(day, dayWeekMap = null) {
    const numericDay = Number(day);
    if (!Number.isFinite(numericDay)) return null;

    if (dayWeekMap instanceof Map && dayWeekMap.has(numericDay)) {
      return dayWeekMap.get(numericDay);
    }

    return numericDay + 1;
  }

  function getGameWeek(game, dayWeekMap = null) {
    return inferWeekFromGameDay(game?.day, dayWeekMap);
  }

  function getPlayoffRecordForTeam(leagueData, teamTid, season) {
    const numericSeason = Number(season);
    const seasonGames = (leagueData?.games || []).filter((game) => {
      if (shouldIgnoreGame(game)) return false;
      if (!Array.isArray(game?.teams) || game.teams.length !== 2) return false;
      if (!game.teams.some((team) => Number(team?.tid) === Number(teamTid))) return false;
      if (!game.teams.every((team) => typeof team?.pts === 'number')) return false;
      if (game.season !== undefined && Number(game.season) !== numericSeason) return false;
      return true;
    });

    const weekMap = buildGameDayWeekMap(seasonGames);
    let wins = 0;
    let losses = 0;

    for (const game of seasonGames) {
      const normalizedWeek = getGameWeek(game, weekMap);
      const isPostseason = Boolean(game.playoffs) || normalizedWeek > REG_SEASON_WEEKS;
      if (!isPostseason) continue;

      const teamSide = game.teams.find((team) => Number(team?.tid) === Number(teamTid));
      const oppSide = game.teams.find((team) => Number(team?.tid) !== Number(teamTid));
      if (!teamSide || !oppSide) continue;

      if (safeNumber(teamSide.pts) > safeNumber(oppSide.pts)) wins += 1;
      else if (safeNumber(teamSide.pts) < safeNumber(oppSide.pts)) losses += 1;
    }

    return { wins, losses };
  }

  function getLiveTeamRecord(leagueData, team, season = getCurrentSeason(leagueData)) {
    if (!leagueData || !team) return null;

    const teamSeason = getLatestTeamSeason(team, season);
    if (!teamSeason) return null;

    const playoffRecord = getPlayoffRecordForTeam(leagueData, team.tid, season);
    const wins = safeNumber(teamSeason.won) + playoffRecord.wins;
    const losses = safeNumber(teamSeason.lost) + playoffRecord.losses;
    const ties = safeNumber(teamSeason.tied);

    return { wins, losses, ties };
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
    // Primary: conference record.
    const aConfPct = Number(formatPct(a.confWins, a.confLosses, a.confTies));
    const bConfPct = Number(formatPct(b.confWins, b.confLosses, b.confTies));
    if (bConfPct !== aConfPct) return bConfPct - aConfPct;

    // Secondary: head-to-head record.
    const h2h = getHeadToHeadRecord(leagueData, a.tid, b.tid);
    if (h2h.aWins !== h2h.bWins) {
      return h2h.bWins - h2h.aWins;
    }

    // Tertiary: division record.
    const aDivPct = Number(formatPct(a.divWins, a.divLosses, a.divTies));
    const bDivPct = Number(formatPct(b.divWins, b.divLosses, b.divTies));
    if (bDivPct !== aDivPct) return bDivPct - aDivPct;

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

          const h2h = getHeadToHeadRecord(leagueData, curr.tid, prev.tid);
          const h2hTied = h2h.aWins === h2h.bWins;

          const sameDivRecord =
            curr.divWins === prev.divWins &&
            curr.divLosses === prev.divLosses &&
            curr.divTies === prev.divTies;

          // Tiebreakers run in order: conf record → H2H → div record. Teams
          // share a rank only when every tier is tied.
          if (sameConfRecord && h2hTied && sameDivRecord) {
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
      // Include players on real teams (tid >= 0), free agents (tid === -1),
      // and draft prospects / upcoming recruits (tid === -2).
      // Retired players (tid === -3) are intentionally excluded.
      .filter((player) => player.tid !== undefined && player.tid >= -2)
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
        // Give draft prospects a small nudge over free agents so an exact-name
        // match on a recruit wins the tiebreaker when both exist.
        if (player.tid === -2) score += 3;

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

    const weekMap = getCurrentSeasonWeekMap(leagueData);

    const games = getGamesForCurrentSeason(leagueData)
      .filter((game) => getGameTeams(game).some((t) => t.tid === team.tid))
      .map((game) => {
        const teams = getGameTeams(game);
        if (teams.length < 2) return null;

        const self = teams.find((t) => t.tid === team.tid);
        const opp = teams.find((t) => t.tid !== team.tid);
        if (!self || !opp) return null;

        const week = getGameWeek(game, weekMap);
        const teamScore = safeNumber(self.pts);
        const oppScore = safeNumber(opp.pts);

        let result = '';
        if (teamScore > oppScore) result = 'W';
        else if (teamScore < oppScore) result = 'L';
        else result = 'T';

        return {
          week,
          opponentTid: opp.tid,
          opponent: getTeamName(getTeamByTid(leagueData, opp.tid)),
          opponentAbbrev: getTeamByTid(leagueData, opp.tid)?.abbrev || '?',
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

  // Reddit aggressively 403s datacenter IPs (Railway, etc.) on the public
  // www.reddit.com / old.reddit.com endpoints regardless of User-Agent. The
  // only reliable fix is OAuth 2.0: register a "script" or "web" app at
  // https://www.reddit.com/prefs/apps and set env vars:
  //   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT
  // With those set we hit oauth.reddit.com with a bearer token which is NOT
  // IP-blocked. We still fall back to the public endpoints for local dev.
  const REDDIT_USER_AGENT =
    process.env.REDDIT_USER_AGENT ||
    'node:nzcfl-discord-bot:v1.2 (by /u/nzcfl-league-bot)';

  // Token cache so we don't re-auth on every request.
  let redditTokenCache = { token: null, expiresAt: 0 };

  async function getRedditAccessToken() {
    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const now = Date.now();
    if (redditTokenCache.token && redditTokenCache.expiresAt > now + 30_000) {
      return redditTokenCache.token;
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetchFn('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': REDDIT_USER_AGENT,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Reddit OAuth token request failed: ${res.status} ${body.slice(0, 200)}`
      );
    }
    const json = await res.json();
    redditTokenCache = {
      token: json.access_token,
      // expires_in is seconds; leave a 60s buffer.
      expiresAt: now + (Number(json.expires_in || 3600) - 60) * 1000,
    };
    return redditTokenCache.token;
  }

  async function fetchRedditJson(path, qs = {}) {
    // path is always "/r/<sub>/new.json" or "/comments/<id>.json" (absolute path).
    const queryString = Object.entries(qs)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const suffix = queryString ? `?${queryString}` : '';

    const attempts = [];

    // Preferred: OAuth bearer (bypasses Reddit's IP-based blocks).
    const token = await getRedditAccessToken().catch((err) => {
      attempts.push(`oauth token: ${err.message}`);
      return null;
    });
    if (token) {
      // oauth.reddit.com paths shouldn't include the trailing .json — strip it.
      const oauthPath = path.replace(/\.json$/i, '');
      const url = `https://oauth.reddit.com${oauthPath}${suffix}`;
      try {
        const res = await fetchFn(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': REDDIT_USER_AGENT,
            Accept: 'application/json',
          },
        });
        if (res.ok) return res.json();
        const body = await res.text().catch(() => '');
        attempts.push(`oauth ${res.status}: ${body.slice(0, 120)}`);
        // 401 means the token is stale — force a refresh next call.
        if (res.status === 401) redditTokenCache = { token: null, expiresAt: 0 };
      } catch (err) {
        attempts.push(`oauth err: ${err.message}`);
      }
    }

    // Fallback: public JSON endpoints with a browser-ish User-Agent chain.
    const publicAgents = [
      REDDIT_USER_AGENT,
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ];
    const hosts = ['www.reddit.com', 'old.reddit.com'];

    for (const ua of publicAgents) {
      for (const host of hosts) {
        const url = `https://${host}${path}${suffix}`;
        try {
          const res = await fetchFn(url, {
            headers: {
              'User-Agent': ua,
              Accept: 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.9',
            },
            redirect: 'follow',
          });
          if (res.ok) return res.json();
          const body = await res.text().catch(() => '');
          attempts.push(`${host} ${res.status}: ${body.slice(0, 120)}`);
        } catch (err) {
          attempts.push(`${host} err: ${err.message}`);
        }
      }
    }

    const hint = process.env.REDDIT_CLIENT_ID
      ? ''
      : ' — set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET to use OAuth, which is not IP-blocked';
    throw new Error(
      `Reddit API unreachable after ${attempts.length} attempt(s)${hint}. Last: ${attempts.slice(-1)[0] || 'unknown'}`
    );
  }

  async function getRedditPosts(limit = 5, sort = 'new') {
    const sub = process.env.REDDIT_SUBREDDIT;
    if (!sub) throw new Error('REDDIT_SUBREDDIT not set in .env');

    const json = await fetchRedditJson(`/r/${sub}/${sort}.json`, {
      limit,
      raw_json: 1,
    });

    return (json?.data?.children || []).map((c) => c.data);
  }

  // Fetch the full comment tree for a Reddit post. Accepts either a permalink
  // ("/r/NZCFL/comments/abc123/...") or a post id ("abc123"). Returns an array
  // of top-level comments where each has a `.replies` array (also comment
  // objects). Uses raw_json=1 so the API returns text without HTML entities.
  async function getRedditComments(permalinkOrId, { limit = 500, depth = 3 } = {}) {
    // Normalize the input into an absolute path, stripping any host.
    let path;
    if (/^https?:/i.test(permalinkOrId)) {
      try {
        const u = new URL(permalinkOrId);
        path = u.pathname;
      } catch {
        path = permalinkOrId;
      }
    } else if (permalinkOrId.startsWith('/')) {
      path = permalinkOrId;
    } else {
      const sub = process.env.REDDIT_SUBREDDIT || 'all';
      path = `/r/${sub}/comments/${permalinkOrId}`;
    }

    // Ensure path ends with .json (and has no trailing slash before it).
    path = path.replace(/\/+$/, '');
    if (!/\.json$/i.test(path)) path += '.json';

    const json = await fetchRedditJson(path, { limit, depth, raw_json: 1 });
    if (!Array.isArray(json) || json.length < 2) return [];

    const walk = (listing) => {
      if (!listing || listing.kind !== 'Listing') return [];
      return (listing.data?.children || [])
        .filter((c) => c.kind === 't1' && c.data)
        .map((c) => {
          const d = c.data;
          return {
            id: d.id,
            author: d.author,
            body: d.body || '',
            created_utc: d.created_utc,
            parent_id: d.parent_id,
            permalink: d.permalink,
            score: d.score,
            author_flair_text: d.author_flair_text || '',
            replies: d.replies && d.replies !== '' ? walk(d.replies) : [],
          };
        });
    };

    return walk(json[1]);
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
    if (!team) return null;

    const candidates = [
      team.abbrev,
      team.region,
      team.name,
      getTeamName(team),
    ];

    for (const candidate of candidates) {
      const key = normalizeLogoKey(candidate);
      if (NORMALIZED_TEAM_LOGO_OVERRIDES.has(key)) {
        return NORMALIZED_TEAM_LOGO_OVERRIDES.get(key);
      }
    }

    const url = String(team?.imgURL || '').trim();
    return url || null;
  }

  function getConferenceLogoUrl(leagueData, cidOrAbbrevOrName) {
    let candidates = [];

    if (typeof cidOrAbbrevOrName === 'number') {
      const confName = getConferenceName(leagueData, cidOrAbbrevOrName);
      const confAbbrev = getConferenceAbbrev(leagueData, cidOrAbbrevOrName);
      candidates = [confAbbrev, confName];
    } else {
      const raw = String(cidOrAbbrevOrName || '').trim();
      candidates = [raw, getConferenceAbbrevFromName(raw)];
    }

    for (const candidate of candidates) {
      const key = normalizeLogoKey(candidate);
      if (NORMALIZED_CONFERENCE_LOGO_OVERRIDES.has(key)) {
        return NORMALIZED_CONFERENCE_LOGO_OVERRIDES.get(key);
      }
    }

    return null;
  }

  module.exports = {
    DATA_DIR,
    MAX_SAVED_FILES,
    getLatestLeagueData,
    invalidateLeagueCache,
    listLeagueFiles,
    findTeamByName,
    saveLeagueData,
    safeNumber,
    formatPct,
    formatRecord,
    addCompetitionRanks,
    getCurrentSeason,
    getCurrentPhase,
    getTeamMap,
    getTeamByTid,
    getTeamNameByTid,
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
    shouldIgnoreGame,
    getGamesForCurrentSeason,
    buildGameDayWeekMap,
    getCurrentSeasonWeekMap,
    inferWeekFromGameDay,
    getGameWeek,
    getGameTeams,
    getGameWinnerTid,
    getGamesBetweenTeams,
    getHeadToHeadRecord,
    getPlayoffRecordForTeam,
    getLiveTeamRecord,
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
    getRedditComments,
    buildTable,
    getTeamLogoUrl,
    getConferenceLogoUrl,
  };
