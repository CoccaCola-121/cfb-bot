// ============================================================
// utils/streakEngine.js
// Generic streak engine for teams, coaches, H2H, previews, alerts
// ============================================================

function sortGames(games) {
  return [...(games || [])].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.week !== b.week) return a.week - b.week;
    return String(a.teamA || '').localeCompare(String(b.teamA || ''));
  });
}

function currentStreak(games, subjectFn) {
  const sorted = sortGames(games).reverse();

  let type = null;
  let length = 0;
  let startGame = null;
  let endGame = null;

  for (const g of sorted) {
    const res = subjectFn(g);
    if (!res) continue;

    if (!type) {
      type = res;
      length = 1;
      endGame = g;
      startGame = g;
      continue;
    }

    if (res === type) {
      length += 1;
      startGame = g;
    } else {
      break;
    }
  }

  if (!type) return null;

  return {
    type: type === 'win' ? 'W' : 'L',
    rawType: type,
    length,
    startGame,
    endGame,
    label: `${type === 'win' ? 'W' : 'L'}${length}`,
  };
}

function computeStreaks(games, subjectFn) {
  const sorted = sortGames(games);
  const streaks = [];
  let cur = null;

  for (const g of sorted) {
    const res = subjectFn(g);
    if (!res) continue;

    if (!cur) {
      cur = {
        type: res,
        length: 1,
        start: g,
        end: g,
        games: [g],
      };
      continue;
    }

    if (res === cur.type) {
      cur.length += 1;
      cur.end = g;
      cur.games.push(g);
    } else {
      streaks.push(cur);
      cur = {
        type: res,
        length: 1,
        start: g,
        end: g,
        games: [g],
      };
    }
  }

  if (cur) streaks.push(cur);
  return streaks;
}

function longestStreaks(games, subjectFn, kind = 'win', n = 5) {
  return computeStreaks(games, subjectFn)
    .filter((s) => s.type === kind)
    .sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      if (b.end.year !== a.end.year) return b.end.year - a.end.year;
      return b.end.week - a.end.week;
    })
    .slice(0, n)
    .map((s) => ({
      type: s.type,
      length: s.length,
      fromYear: s.start.year,
      fromWeek: s.start.week,
      toYear: s.end.year,
      toWeek: s.end.week,
      start: s.start,
      end: s.end,
      games: s.games,
    }));
}

function recordFor(games, subjectFn) {
  let wins = 0;
  let losses = 0;

  for (const g of games || []) {
    const res = subjectFn(g);
    if (res === 'win') wins += 1;
    if (res === 'loss') losses += 1;
  }

  return {
    wins,
    losses,
    games: wins + losses,
    pct: wins + losses > 0 ? wins / (wins + losses) : 0,
  };
}

function groupByOpponent(games, getOpponent) {
  const map = new Map();

  for (const g of games || []) {
    const opp = getOpponent(g);
    if (!opp) continue;
    if (!map.has(opp)) map.set(opp, []);
    map.get(opp).push(g);
  }

  return map;
}

function opponentStreaks(games, subjectFn, getOpponent) {
  const groups = groupByOpponent(games, getOpponent);
  const out = [];

  for (const [opponent, gs] of groups.entries()) {
    for (const s of computeStreaks(gs, subjectFn)) {
      out.push({
        opponent,
        type: s.type,
        length: s.length,
        start: s.start,
        end: s.end,
        games: s.games,
      });
    }
  }

  return out;
}

function recordVs(games, subjectFn, getOpponent) {
  const map = new Map();

  for (const g of games || []) {
    const res = subjectFn(g);
    if (!res) continue;

    const opponent = getOpponent(g);
    if (!opponent) continue;

    if (!map.has(opponent)) {
      map.set(opponent, {
        opponent,
        wins: 0,
        losses: 0,
        games: 0,
        lastGame: null,
      });
    }

    const row = map.get(opponent);
    if (res === 'win') row.wins += 1;
    if (res === 'loss') row.losses += 1;
    row.games += 1;
    row.lastGame = g;
  }

  return map;
}

function dominanceScore(wins, losses, minGames = 3) {
  const games = wins + losses;
  if (games < minGames) return null;
  return (wins - losses) * Math.log2(games + 1);
}

function didBreakStreak(previousGames, newGame, subjectFn) {
  const before = currentStreak(previousGames, subjectFn);
  const after = currentStreak([...(previousGames || []), newGame], subjectFn);

  if (!before || !after) return null;
  if (before.type === after.type) return null;

  return {
    brokenType: before.type,
    brokenLength: before.length,
    newType: after.type,
    newLength: after.length,
    before,
    after,
  };
}

function didExtendStreak(previousGames, newGame, subjectFn) {
  const before = currentStreak(previousGames, subjectFn);
  const after = currentStreak([...(previousGames || []), newGame], subjectFn);

  if (!before || !after) return null;
  if (before.type !== after.type) return null;
  if (after.length <= before.length) return null;

  return {
    type: after.type,
    previousLength: before.length,
    newLength: after.length,
    before,
    after,
  };
}

module.exports = {
  sortGames,
  currentStreak,
  computeStreaks,
  longestStreaks,
  recordFor,
  groupByOpponent,
  opponentStreaks,
  recordVs,
  dominanceScore,
  didBreakStreak,
  didExtendStreak,
};