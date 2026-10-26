const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getConferenceDivisionStandings,
  getConferenceLogoUrl,
  getConferenceColor,
  getConferenceAbbrev,
} = require('../utils/data');
const { getUserTeam } = require('../utils/userMap');
const {
  getTeamMetaMaps,
  getRelevantConferenceGames,
  getNextRegularSeasonDay,
  buildCurrentState,
  buildCurrentH2H,
  cloneState,
  cloneH2H,
  applyOutcome,
  isClinchedAfterRemaining,
} = require('../utils/divisionRace');

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
      const clinched = isClinchedAfterRemaining(
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
  const baseState = buildCurrentState(division);
  const baseH2H = buildCurrentH2H(leagueData, divisionTeamTids);

  const alreadyClinched = division.teams
    .filter((team) =>
      isClinchedAfterRemaining(baseState, baseH2H, relevantGames, divisionTeamTids, team.tid)
    )
    .map((team) => ({
      team,
      scenarios: ['Has already clinched'],
      alreadyClinched: true,
      week: nextWeekDay,
    }));
  if (alreadyClinched.length) return alreadyClinched;

  if (!relevantGames.length) return [];
  if (!Number.isInteger(nextWeekDay)) return [];

  const nextWeekGames = relevantGames.filter((game) => game.day === nextWeekDay);
  const laterGames = relevantGames.filter((game) => game.day > nextWeekDay);
  if (!nextWeekGames.length) return [];

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
      alreadyClinched: false,
      week: nextWeekDay,
    });
  }

  return output;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clinchscenarios')
    .setDescription('Show this week’s division clinch scenarios')
    .addStringOption((opt) =>
      opt
        .setName('conference')
        .setDescription('Conference abbreviation (defaults to your linked team conference)')
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
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) {
      return interaction.editReply('❌ No league data loaded.');
    }

    let conferenceArg = interaction.options.getString('conference');
    if (!conferenceArg) {
      const userTeam = await getUserTeam(leagueData, interaction.user.id);
      if (!userTeam) {
        return interaction.editReply(
          '❌ No conference specified and no linked coach found. Pass a conference or run `/iam coach:<your name>` first.'
        );
      }
      conferenceArg = getConferenceAbbrev(leagueData, userTeam.cid);
      if (!conferenceArg) {
        return interaction.editReply(`❌ Could not determine the conference for **${userTeam.abbrev}**.`);
      }
    }

    const nextWeekDay = getNextRegularSeasonDay(leagueData);
    if (!Number.isInteger(nextWeekDay)) {
      return interaction.editReply('No clinch scenarios this week.');
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
        if (entry.alreadyClinched) {
          return `**${entry.team.abbrev}** has clinched`;
        }
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
      .setColor(getConferenceColor(leagueData, confStandings.conferenceAbbrev))
      .setDescription(divisionSections.join('\n\n').slice(0, 4000))
      .setFooter({
        text: `Week ${scenarioWeek ?? '?'} • Clinches confirmed through conference, group H2H and division records; later tiebreakers unresolved.`,
      });

    const logo = getConferenceLogoUrl(leagueData, confStandings.conferenceAbbrev);
    if (logo) embed.setThumbnail(logo);

    return interaction.editReply({ embeds: [embed] });
  },
};
