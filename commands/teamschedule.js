// ============================================================
//  commands/teamschedule.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData, getTeamSchedule, getCurrentSeason, getTeamName } = require('../utils/data');
const { getUserTeam } = require('../utils/userMap');
const { getWeekLabel } = require('../utils/weekLabels');
const { findMatchingTeam } = require('../utils/sheets');
const { loadAllGames, sameTeam } = require('../utils/h2h');
const { isLive } = require('../utils/seasonMode');

const H2H_TRACKED_SINCE_SEASON = 2025;

function isPlaceholderScore(teamScore, oppScore) {
  return (
    (teamScore === 1 && oppScore === 0) ||
    (teamScore === 0 && oppScore === 1)
  );
}

function resolveTeam(leagueData, teamArg) {
  if (!teamArg) return null;

  const exactAbbrev = (leagueData.teams || []).find(
    (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === String(teamArg || '').toUpperCase().trim()
  );
  if (exactAbbrev) return exactAbbrev;

  return findMatchingTeam(leagueData, teamArg);
}

async function getHistoricalTeamSchedule(leagueData, team, year) {
  const allGames = await loadAllGames();
  const teamName = getTeamName(team);

  const games = allGames
    .filter((g) => Number(g.year) === Number(year))
    .filter((g) => sameTeam(g.teamA, teamName, leagueData) || sameTeam(g.teamB, teamName, leagueData))
    .map((g) => {
      const isTeamA = sameTeam(g.teamA, teamName, leagueData);
      const opponentName = isTeamA ? g.teamB : g.teamA;
      const opponentTeam = findMatchingTeam(leagueData, opponentName);
      const teamScore = isTeamA ? g.scoreA : g.scoreB;
      const oppScore = isTeamA ? g.scoreB : g.scoreA;

      let result = '';
      if (teamScore > oppScore) result = 'W';
      else if (teamScore < oppScore) result = 'L';
      else result = 'T';

      return {
        week: g.week,
        weekLabel: g.weekLabel || getWeekLabel(g.week),
        opponentAbbrev: opponentTeam?.abbrev || String(opponentName || '').trim(),
        teamScore,
        oppScore,
        result,
      };
    })
    .sort((a, b) => (a.week ?? 999) - (b.week ?? 999));

  return {
    season: Number(year),
    team,
    games,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('teamschedule')
    .setDescription('Show a team schedule with scores')
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation, e.g. MSU (defaults to your linked team if you ran /iam)')
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('year')
        .setDescription('Season year, e.g. 2059. Uses H2H history for past seasons.')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const teamArg = interaction.options.getString('team');
    const yearArg = interaction.options.getInteger('year');
    let abbrev = null;
    let team = null;

    if (teamArg) {
      abbrev = teamArg.toUpperCase().trim();
      team = resolveTeam(leagueData, teamArg);
    } else {
      const userTeam = await getUserTeam(leagueData, interaction.user.id);
      if (!userTeam) {
        return interaction.editReply(
          '❌ No team specified and no linked coach found. ' +
            'Pass a team (e.g. `team: MSU`) or run `/iam coach:<your name>` first.'
        );
      }
      abbrev = String(userTeam.abbrev || '').toUpperCase().trim();
      team = userTeam;
    }

    if (!team) {
      return interaction.editReply(`❌ No active team found with abbreviation **${abbrev}**.`);
    }

    const currentSeason = Number(getCurrentSeason(leagueData));
    const targetYear = yearArg || currentSeason;
    const useLiveSchedule = targetYear === currentSeason && isLive(leagueData);

    let result;
    if (useLiveSchedule) {
      result = getTeamSchedule(leagueData, team.abbrev);
    } else {
      result = await getHistoricalTeamSchedule(leagueData, team, targetYear);
    }

    if (result.games.length === 0) {
      const historicalNote = targetYear < H2H_TRACKED_SINCE_SEASON
        ? ` H2H schedule history starts in **${H2H_TRACKED_SINCE_SEASON}**.`
        : '';
      return interaction.editReply(`No games found for **${result.team.abbrev}** in **${targetYear}**.${historicalNote}`);
    }

    const lines = result.games.map((g) => {
      const weekLabel = g.weekLabel || getWeekLabel(g.week);
      if (isPlaceholderScore(g.teamScore, g.oppScore)) {
        const resultWord = g.result === 'W' ? 'Won' : g.result === 'L' ? 'Lost' : 'Tied';
        return `**${weekLabel}** — ${resultWord} vs **${g.opponentAbbrev}**`;
      }
      return `**${weekLabel}** — ${g.result} vs **${g.opponentAbbrev}** (${g.teamScore}-${g.oppScore})`;
    });

    const chunkSize = 20;
    const chunks = [];
    for (let i = 0; i < lines.length; i += chunkSize) {
      chunks.push(lines.slice(i, i + chunkSize));
    }

    const embeds = chunks.map((chunk, idx) =>
      new EmbedBuilder()
        .setTitle(
          idx === 0
            ? `📅 ${result.team.region} ${result.team.name} (${result.team.abbrev}) Schedule`
            : `${result.team.abbrev} Schedule — continued`
        )
        .setColor(0x5865f2)
        .setDescription(chunk.join('\n'))
        .setFooter({
          text: useLiveSchedule
            ? `Season ${result.season}`
            : `Season ${result.season} · H2H history`
        })
    );

    return interaction.editReply({ embeds: embeds.slice(0, 10) });
  },
};
