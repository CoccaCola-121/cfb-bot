// ============================================================
//  commands/scores.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getGamesForCurrentSeason,
  getCurrentSeasonWeekMap,
  getGameWeek,
  getGameTeamDisplayName,
} = require('../utils/data');
const { getWeekLabel } = require('../utils/weekLabels');

const FOOTER_TEXT = 'Postseason codes: 13=CCG, 14=Bowls, 15=QF, 16=SF, 18=Natty';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scores')
    .setDescription('Show game scores/results')
    .addIntegerOption((opt) =>
      opt
        .setName('week')
        .setDescription('Week number (leave blank for the latest week)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData || !leagueData.games) {
      return interaction.editReply('❌ No game data found. Ask a commissioner to run `/loadweek`.');
    }

    const allGames = getGamesForCurrentSeason(leagueData).filter((game) => {
      const teams = game.teams || [];
      return (
        teams.length === 2 &&
        teams.every((team) => typeof team?.pts === 'number' && !Number.isNaN(team.pts))
      );
    });
    if (allGames.length === 0) {
      return interaction.editReply('No games found in the loaded data.');
    }

    const weekMap = getCurrentSeasonWeekMap(leagueData);

    const weekBuckets = new Map();
    for (const game of allGames) {
      const week = getGameWeek(game, weekMap);
      if (week === null) continue;
      if (!weekBuckets.has(week)) weekBuckets.set(week, []);
      weekBuckets.get(week).push(game);
    }

    const availableWeeks = [...weekBuckets.keys()].sort((a, b) => b - a);
    if (availableWeeks.length === 0) {
      return interaction.editReply('No games with inferred weeks were found.');
    }

    const requestedWeek = interaction.options.getInteger('week');
    const week = requestedWeek ?? availableWeeks[0];
    const games = weekBuckets.get(week);

    if (!games || games.length === 0) {
      return interaction.editReply(
        `No games found for ${getWeekLabel(week)}. Available weeks: ${availableWeeks.slice(0, 10).join(', ')}`
      );
    }

    const lines = games.map((g) => {
      const team0 = g.teams?.[0];
      const team1 = g.teams?.[1];

      if (!team0 || !team1) {
        return 'Unknown matchup';
      }

      const homeTeam = getGameTeamDisplayName(leagueData, team0);
      const awayTeam = getGameTeamDisplayName(leagueData, team1);
      const homePts = team0.pts ?? '?';
      const awayPts = team1.pts ?? '?';

      const homeWon = Number(homePts) > Number(awayPts);
      const awayWon = Number(awayPts) > Number(homePts);

      const homeDisplay = homeWon
        ? `**${homeTeam} ${homePts}**`
        : `${homeTeam} ${homePts}`;

      const awayDisplay = awayWon
        ? `**${awayTeam} ${awayPts}**`
        : `${awayTeam} ${awayPts}`;

      return `${awayDisplay} @ ${homeDisplay}`;
    });

    const chunkSize = 20;
    const chunks = [];
    for (let i = 0; i < lines.length; i += chunkSize) {
      chunks.push(lines.slice(i, i + chunkSize));
    }

    const label = getWeekLabel(week);

    const embeds = chunks.map((chunk, idx) =>
      new EmbedBuilder()
        .setTitle(
          idx === 0
            ? `🏈 ${label} Scores (${games.length} games)`
            : `${label} — continued`
        )
        .setColor(0x8b1a1a)
        .setDescription(chunk.join('\n'))
        .setFooter({ text: FOOTER_TEXT })
    );

    return interaction.editReply({ embeds: embeds.slice(0, 10) });
  },
};
