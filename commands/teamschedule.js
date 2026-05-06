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
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');

const H2H_TRACKED_SINCE_SEASON = 2025;
const INFO_SHEET_ID =
  process.env.NZCFL_INFO_SHEET_ID ||
  process.env.GOOGLE_SHEET_ID ||
  '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';

function isPlaceholderScore(teamScore, oppScore) {
  return (
    (teamScore === 1 && oppScore === 0) ||
    (teamScore === 0 && oppScore === 1)
  );
}

function findYearColumn(rows, year) {
  const yearText = String(year).trim();
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const idx = rows[r].findIndex((c) => String(c || '').trim() === yearText);
    if (idx !== -1) return idx;
  }
  return -1;
}

function findWeekPairs(rows, yearCol) {
  const pairs = [];
  const seenWeeks = new Set();

  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    for (let c = yearCol; c < rows[r].length; c++) {
      const weekMatch = String(rows[r][c] || '').match(/^Week\s+(\d+)$/i);
      if (!weekMatch) continue;
      const weekNum = Number(weekMatch[1]);
      if (seenWeeks.has(weekNum)) continue;

      for (let rr = r; rr < Math.min(r + 4, rows.length); rr++) {
        const left = String(rows[rr][c] || '').trim().toLowerCase();
        const right = String(rows[rr][c + 1] || '').trim().toLowerCase();
        if (left === 'away' && right === 'home') {
          seenWeeks.add(weekNum);
          pairs.push({ week: weekNum, awayCol: c, homeCol: c + 1, dataStartRow: rr + 1 });
          break;
        }
      }
    }
  }

  return pairs.sort((a, b) => a.week - b.week);
}

function findOocMatchup(rows, team, pair) {
  for (let r = pair.dataStartRow; r < rows.length; r++) {
    const away = String(rows[r][pair.awayCol] || '').trim();
    const home = String(rows[r][pair.homeCol] || '').trim();
    if (!away && !home) continue;

    if (sameTeam(away, getTeamName(team), getLatestLeagueData())) {
      return home ? `@ ${home}` : null;
    }
    if (sameTeam(home, getTeamName(team), getLatestLeagueData())) {
      return away ? `vs ${away}` : null;
    }
  }

  return null;
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

  let games = allGames
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

  const hasRealPlayoffGame = games.some((g) => Number(g.week) >= 15);
  if (hasRealPlayoffGame) {
    games = games.filter((g) => !(Number(g.week) === 14 && isPlaceholderScore(g.teamScore, g.oppScore)));
  }

  return {
    season: Number(year),
    team,
    games,
  };
}

async function getFutureTeamSchedule(team, year) {
  const rows = await fetchSheetCsv(INFO_SHEET_ID, 'OOC');
  const yearCol = findYearColumn(rows, year);
  if (yearCol === -1) {
    return { season: Number(year), team, games: [] };
  }

  const weekPairs = findWeekPairs(rows, yearCol);
  const pairByWeek = new Map(weekPairs.map((pair) => [pair.week, pair]));
  const games = [];

  for (let week = 1; week <= 12; week++) {
    const pair = pairByWeek.get(week);
    const matchup = pair ? findOocMatchup(rows, team, pair) : null;
    games.push({
      week,
      weekLabel: getWeekLabel(week),
      isFuture: true,
      matchup,
    });
  }

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
    if (targetYear > currentSeason) {
      result = await getFutureTeamSchedule(team, targetYear);
    } else if (useLiveSchedule) {
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
      if (g.isFuture) {
        return g.matchup
          ? `**Week ${g.week}** — ${g.matchup}`
          : `**Week ${g.week}** — *TBD*`;
      }
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
          text: targetYear > currentSeason
            ? `Season ${result.season} · OOC scheduled so far`
            : useLiveSchedule
            ? `Season ${result.season}`
            : `Season ${result.season} · H2H history`
        })
    );

    return interaction.editReply({ embeds: embeds.slice(0, 10) });
  },
};
