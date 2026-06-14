const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getConferenceDivisionStandings,
  getConferenceLogoUrl,
  getCurrentSeason,
} = require('../utils/data');
const { findMatchingTeam } = require('../utils/sheets');
const { REG_SEASON_WEEKS } = require('../utils/weekLabels');

function recordPct(wins = 0, losses = 0, ties = 0) {
  const games = wins + losses + ties;
  if (games <= 0) return 0;
  return (wins + ties * 0.5) / games;
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

  if (!days.length) return null;
  return Math.min(...days);
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

function pairKey(tidA, tidB) {
  return tidA < tidB ? `${tidA}-${tidB}` : `${tidB}-${tidA}`;
}

function cloneState(state) {
  return new Map([...state.entries()].map(([tid, value]) => [tid, { ...value }]));
}

function cloneH2H(h2hMap) {
  return new Map([...h2hMap.entries()].map(([key, value]) => [key, { ...value }]));
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

  if (tidA === pair.lowTid) {
    return { aWins: pair.lowWins, bWins: pair.highWins };
  }
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

function isClenchedAfterRemaining(state, h2hMap, remainingGames, divisionTeamTids, targetTid, idx = 0) {
  if (idx >= remainingGames.length) {
    return isUniqueDivisionLeader(state, h2hMap, divisionTeamTids, targetTid);
  }

  const game = remainingGames[idx];
  const outcomes = [game.homeTid, game.awayTid];

  for (const winnerTid of outcomes) {
    const next = applyOutcome(state, h2hMap, game, winnerTid);
    const stillClinched = isClenchedAfterRemaining(
      next.state,
      next.h2hMap,
      remainingGames,
      divisionTeamTids,
      targetTid,
      idx + 1
    );
    if (!stillClinched) return false;
  }

  return true;
}

function combineTerms(a, b) {
  let diff = 0;
  const out = [];

  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) {
      out.push(a[i]);
      continue;
    }
    if (a[i] === -1 || b[i] === -1) return null;
    diff += 1;
    out.push(-1);
    if (diff > 1) return null;
  }

  return diff === 1 ? out : null;
}

function dedupeTerms(terms) {
  const seen = new Set();
  const out = [];
  for (const term of terms) {
    const key = term.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

function termSubsumes(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== -1 && a[i] !== b[i]) return false;
  }
  return true;
}

function minimizeScenarios(terms) {
  let current = dedupeTerms(terms);
  const primes = [];

  while (current.length) {
    const used = new Set();
    const next = [];

    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const combined = combineTerms(current[i], current[j]);
        if (!combined) continue;
        used.add(i);
        used.add(j);
        next.push(combined);
      }
    }

    for (let i = 0; i < current.length; i++) {
      if (!used.has(i)) primes.push(current[i]);
    }

    current = dedupeTerms(next);
  }

  const dedupedPrimes = dedupeTerms(primes);
  return dedupedPrimes.filter((term, idx) =>
    !dedupedPrimes.some((other, otherIdx) =>
      idx !== otherIdx &&
      termSubsumes(other, term) &&
      other.some((bit, bitIdx) => bit !== term[bitIdx])
    )
  );
}

function describeOutcome(game, bit, byTid) {
  const winnerTid = bit === 1 ? game.homeTid : game.awayTid;
  const loserTid = bit === 1 ? game.awayTid : game.homeTid;
  const winner = byTid.get(winnerTid);
  const loser = byTid.get(loserTid);
  return `${winner?.abbrev || winnerTid} over ${loser?.abbrev || loserTid}`;
}

function formatScenarioTerms(terms, games, byTid) {
  return minimizeScenarios(terms).map((term) => {
    const parts = [];
    for (let i = 0; i < term.length; i++) {
      if (term[i] === -1) continue;
      parts.push(describeOutcome(games[i], term[i], byTid));
    }
    return parts.length ? parts.join(' + ') : 'Any combination of results';
  });
}

function enumerateNextWeekScenarios(baseState, baseH2H, nextWeekGames, laterGames, divisionTeamTids) {
  const clinchMasksByTid = new Map(divisionTeamTids.map((tid) => [tid, []]));
  const totalMasks = 1 << nextWeekGames.length;

  for (let mask = 0; mask < totalMasks; mask++) {
    let currentState = cloneState(baseState);
    let currentH2H = cloneH2H(baseH2H);
    const term = [];

    for (let i = 0; i < nextWeekGames.length; i++) {
      const bit = (mask >> i) & 1;
      term.push(bit);
      const winnerTid = bit === 1 ? nextWeekGames[i].homeTid : nextWeekGames[i].awayTid;
      const applied = applyOutcome(currentState, currentH2H, nextWeekGames[i], winnerTid);
      currentState = applied.state;
      currentH2H = applied.h2hMap;
    }

    for (const tid of divisionTeamTids) {
      const clinched = isClenchedAfterRemaining(
        currentState,
        currentH2H,
        laterGames,
        divisionTeamTids,
        tid
      );
      if (clinched) {
        clinchMasksByTid.get(tid).push(term);
      }
    }
  }

  return clinchMasksByTid;
}

function buildDivisionScenarios(leagueData, division, nextWeekDay) {
  const divisionTeamTids = division.teams.map((team) => team.tid);
  const { byTid } = getTeamMetaMaps(leagueData);
  const relevantGames = getRelevantConferenceGames(leagueData, divisionTeamTids);
  if (!relevantGames.length) return [];
  if (!Number.isInteger(nextWeekDay)) return [];

  const nextWeekGames = relevantGames.filter((game) => game.day === nextWeekDay);
  const laterGames = relevantGames.filter((game) => game.day > nextWeekDay);
  if (!nextWeekGames.length) return [];

  const baseState = buildCurrentState(division);
  const baseH2H = buildCurrentH2H(leagueData, divisionTeamTids);
  const clinchMasksByTid = enumerateNextWeekScenarios(
    baseState,
    baseH2H,
    nextWeekGames,
    laterGames,
    divisionTeamTids
  );

  const output = [];
  for (const team of division.teams) {
    const terms = clinchMasksByTid.get(team.tid) || [];
    if (!terms.length) continue;
    output.push({
      team,
      scenarios: formatScenarioTerms(terms, nextWeekGames, byTid),
      week: nextWeekDay,
    });
  }

  return output;
}

function findTeamDivision(confStandings, tid) {
  for (const division of confStandings.divisions || []) {
    const team = division.teams.find((entry) => entry.tid === tid);
    if (team) return division;
  }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clinchscenarios')
    .setDescription('Show this week’s division clinch scenarios')
    .addStringOption((opt) =>
      opt
        .setName('conference')
        .setDescription('Conference abbreviation')
        .setRequired(false)
        .addChoices(
          { name: 'ACC', value: 'ACC' },
          { name: 'B1G', value: 'B1G' },
          { name: 'B12', value: 'B12' },
          { name: 'P12', value: 'P12' },
          { name: 'SEC', value: 'SEC' },
          { name: 'MW', value: 'MW' },
          { name: 'MAC', value: 'MAC' },
          { name: 'C-USA', value: 'C-USA' },
          { name: 'AAC', value: 'AAC' },
          { name: 'SUN', value: 'SUN' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation or name')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const conferenceArg = interaction.options.getString('conference');
    const teamArg = interaction.options.getString('team');
    const nextWeekDay = getNextRegularSeasonDay(leagueData);

    if (conferenceArg && teamArg) {
      return interaction.editReply('❌ Pass either `conference` or `team`, not both.');
    }
    if (!conferenceArg && !teamArg) {
      return interaction.editReply('❌ Pass a `conference` or a `team`.');
    }

    if (!Number.isInteger(nextWeekDay)) {
      return interaction.editReply('No clinch scenarios this week.');
    }

    if (teamArg) {
      const team = findMatchingTeam(leagueData, teamArg);
      if (!team || team.disabled) {
        return interaction.editReply(`❌ Could not find a team matching **${teamArg}**.`);
      }

      const allConfs = ['ACC', 'B1G', 'B12', 'P12', 'SEC', 'MW', 'MAC', 'C-USA', 'AAC', 'SUN'];
      let teamConference = null;
      let teamDivision = null;
      for (const conf of allConfs) {
        const standings = getConferenceDivisionStandings(leagueData, conf);
        if (!standings) continue;
        const division = findTeamDivision(standings, team.tid);
        if (division) {
          teamConference = standings;
          teamDivision = division;
          break;
        }
      }

      if (!teamConference || !teamDivision) {
        return interaction.editReply(`❌ Could not find standings context for **${team.abbrev}**.`);
      }

      const divisionScenarios = buildDivisionScenarios(leagueData, teamDivision, nextWeekDay)
        .filter((entry) => entry.team.tid === team.tid);

      if (!divisionScenarios.length) {
        return interaction.editReply(`No clinch scenarios this week for **${team.abbrev}**.`);
      }

      const entry = divisionScenarios[0];
      const description = entry.scenarios.map((line, idx) => `\`${idx + 1}.\` ${line}`).join('\n');
      const embed = new EmbedBuilder()
        .setTitle(`Clinch Scenarios — ${entry.team.name} (${entry.team.abbrev})`)
        .setColor(0x27ae60)
        .setDescription(description)
        .setFooter({
          text: `Week ${entry.week} • Division title clinch scenarios only`,
        });

      const logo = getConferenceLogoUrl(leagueData, teamConference.conferenceAbbrev);
      if (logo) embed.setThumbnail(logo);

      return interaction.editReply({ embeds: [embed] });
    }

    const confStandings = getConferenceDivisionStandings(leagueData, conferenceArg);
    if (!confStandings) {
      return interaction.editReply(`❌ Could not find conference **${conferenceArg}**.`);
    }

    const divisionSections = [];
    let scenarioWeek = null;

    for (const division of confStandings.divisions) {
      const scenarios = buildDivisionScenarios(leagueData, division, nextWeekDay);
      if (!scenarios.length) continue;
      if (scenarioWeek === null) scenarioWeek = scenarios[0].week;

      const lines = scenarios.map((entry) => {
        const firstFew = entry.scenarios.slice(0, 3).join('; ');
        const suffix = entry.scenarios.length > 3 ? `; +${entry.scenarios.length - 3} more` : '';
        return `**${entry.team.abbrev}** clinches with: ${firstFew}${suffix}`;
      });

      divisionSections.push(`**${division.divisionName}**\n${lines.join('\n')}`);
    }

    if (!divisionSections.length) {
      return interaction.editReply(`No clinch scenarios this week for **${confStandings.conferenceAbbrev}**.`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`Clinch Scenarios — ${confStandings.conferenceAbbrev}`)
      .setColor(0x27ae60)
      .setDescription(divisionSections.join('\n\n').slice(0, 4000))
      .setFooter({
        text: `Week ${scenarioWeek ?? '?'} • Division title clinch scenarios only`,
      });

    const logo = getConferenceLogoUrl(leagueData, confStandings.conferenceAbbrev);
    if (logo) embed.setThumbnail(logo);

    return interaction.editReply({ embeds: [embed] });
  },
};
