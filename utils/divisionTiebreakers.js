const { REG_SEASON_WEEKS } = require('./weekLabels');

function recordPct(wins = 0, losses = 0, ties = 0) {
  const games = wins + losses + ties;
  return games > 0 ? (wins + ties * 0.5) / games : 0;
}

function pairKey(tidA, tidB) {
  return tidA < tidB ? `${tidA}-${tidB}` : `${tidB}-${tidA}`;
}

function buildDivisionH2H(leagueData, divisionTeamTids, currentSeason) {
  const tids = new Set(divisionTeamTids);
  const h2h = new Map();

  for (const game of leagueData.games || []) {
    if (currentSeason != null && game.season != null && Number(game.season) !== Number(currentSeason)) continue;
    if (game.playoffs || Number(game.day) > REG_SEASON_WEEKS) continue;
    const [a, b] = game.teams || [];
    if (!a || !b || typeof a.pts !== 'number' || typeof b.pts !== 'number') continue;
    const aTid = Number(a.tid);
    const bTid = Number(b.tid);
    if (!tids.has(aTid) || !tids.has(bTid)) continue;

    const key = pairKey(aTid, bTid);
    if (!h2h.has(key)) {
      h2h.set(key, {
        lowTid: Math.min(aTid, bTid), highTid: Math.max(aTid, bTid),
        lowWins: 0, highWins: 0, ties: 0,
      });
    }
    const pair = h2h.get(key);
    if (a.pts === b.pts) pair.ties += 1;
    else if ((a.pts > b.pts ? aTid : bTid) === pair.lowTid) pair.lowWins += 1;
    else pair.highWins += 1;
  }
  return h2h;
}

function keepBest(tids, score) {
  const values = tids.map(score);
  const best = Math.max(...values);
  return tids.filter((tid, i) => values[i] === best);
}

function getDivisionLeaderTids(state, h2h, tids = [...state.keys()]) {
  if (tids.length <= 1) return [...tids];
  const tied = keepBest(tids, (tid) => {
    const team = state.get(tid);
    return recordPct(team.confWins, team.confLosses, team.confTies);
  });
  if (tied.length === 1) return tied;

  // Head-to-head is a record against the entire conference-record tie group.
  // Pairwise comparisons can form a cycle (A beats B, B beats C, C beats A).
  const records = new Map(tied.map((tid) => [tid, { wins: 0, losses: 0, ties: 0 }]));
  for (const pair of h2h.values()) {
    const low = records.get(pair.lowTid);
    const high = records.get(pair.highTid);
    if (!low || !high) continue;
    low.wins += pair.lowWins;
    low.losses += pair.highWins;
    high.wins += pair.highWins;
    high.losses += pair.lowWins;
    low.ties += pair.ties || 0;
    high.ties += pair.ties || 0;
  }
  let leaders = keepBest(tied, (tid) => {
    const record = records.get(tid);
    return recordPct(record.wins, record.losses, record.ties);
  });
  leaders = keepBest(leaders, (tid) => {
    const record = records.get(tid);
    return record.wins - record.losses;
  });
  leaders = keepBest(leaders, (tid) => {
    const team = state.get(tid);
    return recordPct(team.divWins, team.divLosses, team.divTies);
  });

  // Do not restart head-to-head after narrowing the group, or use names to
  // award a title. Later tiebreakers (e.g. strength of victory) are not modeled.
  // These teams remain possible winners, but none has uniquely clinched.
  return leaders;
}

function rankDivisionTeams(teams, h2h) {
  const state = new Map(teams.map((team) => [team.tid, team]));
  let remaining = [...state.keys()];
  const ranked = [];
  while (remaining.length) {
    const leaders = getDivisionLeaderTids(state, h2h, remaining);
    const rank = ranked.length + 1;
    // Names stabilize display order only; unresolved teams share a rank.
    leaders.sort((a, b) => state.get(a).name.localeCompare(state.get(b).name));
    ranked.push(...leaders.map((tid) => ({ ...state.get(tid), rank })));
    const selected = new Set(leaders);
    remaining = remaining.filter((tid) => !selected.has(tid));
  }
  return ranked;
}

module.exports = { pairKey, buildDivisionH2H, getDivisionLeaderTids, rankDivisionTeams };
