// ============================================================
//  commands/scores.js
//  /scores [week]
//  Shows game results from the football-gm JSON export
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getGamesForCurrentSeason,
  getTeamMap,
  getTeamName,
  inferWeekFromGameDay,
} = require('../utils/data');

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

    const allGames = getGamesForCurrentSeason(leagueData);
    if (allGames.length === 0) {
      return interaction.editReply('No games found in the loaded data.');
    }

    const teamMap = getTeamMap(leagueData);

    const weekBuckets = new Map();
    for (const game of allGames) {
      const week = inferWeekFromGameDay(game.day);
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
        `No games found for Week ${week}. Available weeks: ${availableWeeks.slice(0, 10).join(', ')}`
      );
    }

    const lines = games.map((g) => {
  const team0 = g.teams?.[0];
  const team1 = g.teams?.[1];

  if (!team0 || !team1) {
    return 'Unknown matchup';
  }

  const homeTeam = getTeamName(teamMap.get(team0.tid));
  const awayTeam = getTeamName(teamMap.get(team1.tid));
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

    // Week 12 = Rivalry Week (every team plays its rival)
    const RIVALRY_WEEK = 12;
    const rivalryTag = week === RIVALRY_WEEK ? ' 🔥 Rivalry Week' : '';

    const embeds = chunks.map((chunk, idx) =>
      new EmbedBuilder()
        .setTitle(
          idx === 0
            ? `🏈 Week ${week} Scores${rivalryTag} (${games.length} games)`
            : `Week ${week}${rivalryTag} — continued`
        )
        .setColor(0x8b1a1a)
        .setDescription(chunk.join('\n'))
        .setFooter({ text: `Available weeks: ${availableWeeks.slice(0, 8).join(', ')}` })
    );

    return interaction.editReply({ embeds: embeds.slice(0, 10) });
  },
};