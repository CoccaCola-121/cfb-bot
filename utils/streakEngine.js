// ============================================================
// utils/streakEngine.js
// Generic streak engine for teams + coaches
// ============================================================

/**
 * subjectFn(game) => 'win' | 'loss' | null
 * null = ignore game (e.g., coach not involved)
 */

function sortGames(games) {
  return [...games].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.week - b.week
  );
}

// ------------------------------------------------------------
// CURRENT STREAK
// ------------------------------------------------------------

function currentStreak(games, subjectFn) {
  const sorted = sortGames(games).reverse();

  let type = null;
  let length = 0;

  for (const g of sorted) {
    const res = subjectFn(g);
    if (!res) continue;

    if (!type) {
      type = res;
      length = 1;
      continue;
    }

    if (res === type) {
      length++;
    } else {
      break;
    }
  }

  if (!type) return null;

  return {
    type: type === 'win' ? 'W' : 'L',
    length,
  };
}

// ------------------------------------------------------------
// ALL STREAKS (CORE ENGINE)
// ------------------------------------------------------------

function computeStreaks(games, subjectFn) {
  const sorted = sortGames(games);

  const streaks = [];

  let current = null;

  for (const g of sorted) {
    const res = subjectFn(g);
    if (!res) continue;

    if (!current) {
      current = {
        type: res,
        length: 1,
        start: g,
        end: g,
      };
      continue;
    }

    if (res === current.type) {
      current.length++;
      current.end = g;
    } else {
      streaks.push(current);

      current = {
        type: res,
        length: 1,
        start: g,
        end: g,
      };
    }
  }

  if (current) streaks.push(current);

  return streaks;
}

// ------------------------------------------------------------
// LONGEST STREAKS
// ------------------------------------------------------------

function longestStreaks(games, subjectFn, kind = 'win', n = 5) {
  const all = computeStreaks(games, subjectFn);

  const filtered = all.filter((s) => s.type === kind);

  filtered.sort((a, b) => b.length - a.length);

  return filtered.slice(0, n).map((s) => ({
    length: s.length,
    fromYear: s.start.year,
    fromWeek: s.start.week,
    toYear: s.end.year,
    toWeek: s.end.week,
  }));
}

// ------------------------------------------------------------
// STREAK VS EACH OPPONENT
// (used for /streaks + /familytree)
// ------------------------------------------------------------

function groupByOpponent(games, getOpponent) {
  const map = new Map();

  for (const g of games) {
    const opp = getOpponent(g);
    if (!opp) continue;

    if (!map.has(opp)) map.set(opp, []);
    map.get(opp).push(g);
  }

  return map;
}

function opponentStreaks(games, subjectFn, getOpponent) {
  const groups = groupByOpponent(games, getOpponent);

  const results = [];

  for (const [opp, gs] of groups.entries()) {
    const streaks = computeStreaks(gs, subjectFn);

    for (const s of streaks) {
      results.push({
        opponent: opp,
        type: s.type,
        length: s.length,
        start: s.start,
        end: s.end,
      });
    }
  }

  return results;
}

// ------------------------------------------------------------
// DOMINANCE (for family tree)
// ------------------------------------------------------------

function dominanceScore(wins, losses) {
  const games = wins + losses;
  if (games < 3) return null;

  const margin = wins - losses;
  return margin * Math.log2(games + 1);
}

// ------------------------------------------------------------
// RECORD VS OPPONENT
// ------------------------------------------------------------

function recordVs(games, subjectFn, getOpponent) {
  const map = new Map();

  for (const g of games) {
    const res = subjectFn(g);
    if (!res) continue;

    const opp = getOpponent(g);
    if (!opp) continue;

    if (!map.has(opp)) map.set(opp, { wins: 0, losses: 0 });

    const r = map.get(opp);

    if (res === 'win') r.wins++;
    else r.losses++;
  }

  return map;
}

// ------------------------------------------------------------
// BREAK STREAK DETECTION (for live alerts)
// ------------------------------------------------------------

function didBreakStreak(prevGames, newGame, subjectFn) {
  const before = currentStreak(prevGames, subjectFn);

  const after = currentStreak([...prevGames, newGame], subjectFn);

  if (!before || !after) return null;

  // broke streak
  if (before.type !== after.type) {
    return {
      brokenType: before.type,
      brokenLength: before.length,
    };
  }

  return null;
}

module.exports = {
  currentStreak,
  computeStreaks,
  longestStreaks,
  opponentStreaks,
  dominanceScore,
  recordVs,
  didBreakStreak,
};