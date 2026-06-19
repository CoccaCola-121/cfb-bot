const { getCurrentSeason } = require('./data');
const { REG_SEASON_WEEKS } = require('./weekLabels');

function recordPct(wins = 0, losses = 0, ties = 0) {
  const games = wins + losses + ties;
  if (games <= 0) return 0;
  return (wins + ties * 0.5) / games;
}

function pairKey(tidA, tidB) {
  return tidA < tidB ? `${tidA}-${tidB}` : `${tidB}-${tidA}`;
}

function cloneState(state) {
  return new Map([...state.entries()].map(([tid, value]) => [tid, { ...value }]));
}

function cloneH2H(h2hMap) {
  return new Map([...h2hMap.entries()].map(([key, value]) => [key, { ...value }]));
}

function getTeamMetaMaps(leagueData) {
  const byTid = new Map();
  for (const team of leagueData.teams || []) {
    if (team.disabled) continue;
    byTid.set(team.tid, {
      tid: team.tid,
      cid: team.cid,
      did: team.did,
      abbrev: team.abbrev || '?',
      name: `${team.region || ''} ${team.name || ''}`.trim(),
      disabled: !!team.disabled,
    });
  }
  return { byTid };
}

function getFutureGames(leagueData) {
  const futureGames = [];

  if (Array.isArray(leagueData.schedule) && leagueData.schedule.length) {
    for (const game of leagueData.schedule) {
      const homeTid = game.homeTid ?? game.home?.tid ?? game.teams?.[0]?.tid;
      const awayTid = game.awayTid ?? game.away?.tid ?? game.teams?.[1]?.tid;
      const day = typeof game.day === 'number' ? game.day : null;
      if (Number.isInteger(homeTid) && Number.isInteger(awayTid) && Number.isInteger(day)) {
        futureGames.push({ homeTid, awayTid, day });
      }
    }
    return futureGames;
  }

  if (Array.isArray(leagueData.games)) {
    for (const game of leagueData.games) {
      const teams = Array.isArray(game.teams) ? game.teams : null;
      if (!teams || teams.length < 2) continue;

      const homeTid = teams[0]?.tid;
      const awayTid = teams[1]?.tid;
      const played =
        typeof teams[0]?.pts === 'number' &&
        typeof teams[1]?.pts === 'number';
      const day = typeof game.day === 'number' ? game.day : null;

      if (!played && Number.isInteger(homeTid) && Number.isInteger(awayTid) && Number.isInteger(day)) {
        futureGames.push({ homeTid, awayTid, day });
      }
    }
  }

  return futureGames;
}

function getRelevantConferenceGames(leagueData, divisionTeamTids) {
  const { byTid } = getTeamMetaMaps(leagueData);
  const divisionTidSet = new Set(divisionTeamTids);

  return getFutureGames(leagueData)
    .filter((game) => game.day <= REG_SEASON_WEEKS)
    .map((game) => {
      const home = byTid.get(game.homeTid);
      const away = byTid.get(game.awayTid);
      if (!home || !away) return null;
      if (home.cid !== away.cid) return null;
      if (!divisionTidSet.has(home.tid) && !divisionTidSet.has(away.tid)) return null;

      return {
        ...game,
        sameDivision: home.did === away.did,
      };
    })
    .filter(Boolean);
}

function getNextRegularSeasonDay(leagueData) {
  const days = getFutureGames(leagueData)
    .map((game) => game.day)
    .filter((day) => Number.isInteger(day) && day <= REG_SEASON_WEEKS);
  return days.length ? Math.min(...days) : null;
}

function buildCurrentState(division) {
  const state = new Map();
  for (const team of division.teams) {
    state.set(team.tid, {
      tid: team.tid,
      name: team.name,
      abbrev: team.abbrev,
      confWins: Number(team.confWins) || 0,
      confLosses: Number(team.confLosses) || 0,
      confTies: Number(team.confTies) || 0,
      divWins: Number(team.divWins) || 0,
      divLosses: Number(team.divLosses) || 0,
      divTies: Number(team.divTies) || 0,
    });
  }
  return state;
}

function buildCurrentH2H(leagueData, divisionTeamTids) {
  const currentSeason = getCurrentSeason(leagueData);
  const divisionTidSet = new Set(divisionTeamTids);
  const map = new Map();

  for (const game of leagueData.games || []) {
    if (currentSeason !== null && currentSeason !== undefined) {
      if (game.season !== undefined && Number(game.season) !== Number(currentSeason)) continue;
    }

    const teams = Array.isArray(game.teams) ? game.teams : null;
    if (!teams || teams.length < 2) continue;
    if (typeof teams[0]?.pts !== 'number' || typeof teams[1]?.pts !== 'number') continue;

    const aTid = Number(teams[0].tid);
    const bTid = Number(teams[1].tid);
    if (!divisionTidSet.has(aTid) || !divisionTidSet.has(bTid)) continue;

    const key = pairKey(aTid, bTid);
    if (!map.has(key)) {
      map.set(key, { lowTid: Math.min(aTid, bTid), highTid: Math.max(aTid, bTid), lowWins: 0, highWins: 0 });
    }

    const pair = map.get(key);
    if (teams[0].pts > teams[1].pts) {
      if (aTid === pair.lowTid) pair.lowWins += 1;
      else pair.highWins += 1;
    } else if (teams[1].pts > teams[0].pts) {
      if (bTid === pair.lowTid) pair.lowWins += 1;
      else pair.highWins += 1;
    }
  }

  return map;
}

function getH2HRecord(h2hMap, tidA, tidB) {
  const key = pairKey(tidA, tidB);
  const pair = h2hMap.get(key);
  if (!pair) return { aWins: 0, bWins: 0 };
  if (tidA === pair.lowTid) return { aWins: pair.lowWins, bWins: pair.highWins };
  return { aWins: pair.highWins, bWins: pair.lowWins };
}

function applyOutcome(state, h2hMap, game, winnerTid) {
  const nextState = cloneState(state);
  const nextH2H = cloneH2H(h2hMap);
  const loserTid = winnerTid === game.homeTid ? game.awayTid : game.homeTid;

  const winner = nextState.get(winnerTid);
  const loser = nextState.get(loserTid);
  if (winner) winner.confWins += 1;
  if (loser) loser.confLosses += 1;

  if (game.sameDivision) {
    if (winner) winner.divWins += 1;
    if (loser) loser.divLosses += 1;

    const key = pairKey(winnerTid, loserTid);
    if (!nextH2H.has(key)) {
      nextH2H.set(key, {
        lowTid: Math.min(winnerTid, loserTid),
        highTid: Math.max(winnerTid, loserTid),
        lowWins: 0,
        highWins: 0,
      });
    }
    const pair = nextH2H.get(key);
    if (winnerTid === pair.lowTid) pair.lowWins += 1;
    else pair.highWins += 1;
  }

  return { state: nextState, h2hMap: nextH2H };
}

function compareDivisionTeamsState(state, h2hMap, tidA, tidB) {
  const a = state.get(tidA);
  const b = state.get(tidB);

  const aConfPct = recordPct(a.confWins, a.confLosses, a.confTies);
  const bConfPct = recordPct(b.confWins, b.confLosses, b.confTies);
  if (bConfPct !== aConfPct) return bConfPct - aConfPct;

  const h2h = getH2HRecord(h2hMap, tidA, tidB);
  if (h2h.aWins !== h2h.bWins) return h2h.bWins - h2h.aWins;

  const aDivPct = recordPct(a.divWins, a.divLosses, a.divTies);
  const bDivPct = recordPct(b.divWins, b.divLosses, b.divTies);
  if (bDivPct !== aDivPct) return bDivPct - aDivPct;

  return a.name.localeCompare(b.name);
}

function teamsShareRank(state, h2hMap, tidA, tidB) {
  const a = state.get(tidA);
  const b = state.get(tidB);
  const sameConf =
    a.confWins === b.confWins &&
    a.confLosses === b.confLosses &&
    a.confTies === b.confTies;
  if (!sameConf) return false;

  const h2h = getH2HRecord(h2hMap, tidA, tidB);
  if (h2h.aWins !== h2h.bWins) return false;

  return (
    a.divWins === b.divWins &&
    a.divLosses === b.divLosses &&
    a.divTies === b.divTies
  );
}

function isUniqueDivisionLeader(state, h2hMap, divisionTeamTids, targetTid) {
  for (const otherTid of divisionTeamTids) {
    if (otherTid === targetTid) continue;
    if (teamsShareRank(state, h2hMap, targetTid, otherTid)) return false;
    if (compareDivisionTeamsState(state, h2hMap, targetTid, otherTid) >= 0) return false;
  }
  return true;
}

function isClinchedAfterRemaining(state, h2hMap, remainingGames, divisionTeamTids, targetTid, idx = 0) {
  if (idx >= remainingGames.length) {
    return isUniqueDivisionLeader(state, h2hMap, divisionTeamTids, targetTid);
  }

  const game = remainingGames[idx];
  for (const winnerTid of [game.homeTid, game.awayTid]) {
    const next = applyOutcome(state, h2hMap, game, winnerTid);
    if (!isClinchedAfterRemaining(next.state, next.h2hMap, remainingGames, divisionTeamTids, targetTid, idx + 1)) {
      return false;
    }
  }
  return true;
}

function canStillWinDivision(state, h2hMap, remainingGames, divisionTeamTids, targetTid, idx = 0) {
  if (idx >= remainingGames.length) {
    return isUniqueDivisionLeader(state, h2hMap, divisionTeamTids, targetTid);
  }

  const game = remainingGames[idx];
  for (const winnerTid of [game.homeTid, game.awayTid]) {
    const next = applyOutcome(state, h2hMap, game, winnerTid);
    if (canStillWinDivision(next.state, next.h2hMap, remainingGames, divisionTeamTids, targetTid, idx + 1)) {
      return true;
    }
  }
  return false;
}

module.exports = {
  getTeamMetaMaps,
  getRelevantConferenceGames,
  getNextRegularSeasonDay,
  buildCurrentState,
  buildCurrentH2H,
  cloneState,
  cloneH2H,
  applyOutcome,
  isClinchedAfterRemaining,
  canStillWinDivision,
};
