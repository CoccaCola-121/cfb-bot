// ============================================================
// commands/rankings.js
// Current Top 25 from the mock committee rankings sheet "Previous" tab.
// Parsing/fetching lives in utils/currentRankings.js so it can also
// be used by /teamstats (and any other command that needs a team's
// current rank).
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getTeamLogoUrl,
  getTeamName,
} = require('../utils/data');
const { matchesTeam: sheetMatchesTeam } = require('../utils/sheets');
const { fetchCurrentRankings } = require('../utils/currentRankings');

function findTeamByName(leagueData, name) {
  if (!leagueData?.teams || !name) return null;
  for (const team of leagueData.teams) {
    if (team.disabled) continue;
    if (sheetMatchesTeam(name, team)) return team;
  }

  const normalized = String(name).toLowerCase().trim();
  return (
    leagueData.teams.find(
      (team) =>
        !team.disabled &&
        (String(team.region || '').toLowerCase() === normalized ||
          getTeamName(team).toLowerCase() === normalized)
    ) || null
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rankings')
    .setDescription('Show the current Top-25 rankings.')
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription('How many to show (1-25, default 25)')
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const limit = interaction.options.getInteger('limit') ?? 25;
    const { label, entries } = await fetchCurrentRankings({ limit });

    if (!entries.length) {
      return interaction.editReply('❌ Could not parse the current rankings tab.');
    }

    const leagueData = getLatestLeagueData();
    const lines = entries.map((entry) => `**${entry.rank}.** ${entry.name}`);

    const embed = new EmbedBuilder()
      .setTitle(`Top ${entries.length} — ${label || 'Current Rankings'}`)
      .setColor(0x2980b9)
      .setDescription(lines.join('\n'))
      .setTimestamp();

    if (leagueData) {
      const topTeam = findTeamByName(leagueData, entries[0]?.name);
      if (topTeam) {
        const logo = getTeamLogoUrl(topTeam);
        if (logo) embed.setThumbnail(logo);
      }
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
