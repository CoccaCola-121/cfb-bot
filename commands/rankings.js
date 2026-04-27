// ============================================================
// commands/rankings.js
// Most recent Top-25 ranked column from the Rankings History sheet.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  loadRankingsHistory,
  findLatestColumn,
  readRankingColumn,
  formatColumnLabel,
} = require('../utils/rankingsHistory');
const { getLatestLeagueData, getTeamLogoUrl, getTeamName } = require('../utils/data');
const { matchesTeam: sheetMatchesTeam } = require('../utils/sheets');

function findTeamByName(leagueData, name) {
  if (!leagueData?.teams || !name) return null;
  for (const t of leagueData.teams) {
    if (t.disabled) continue;
    if (sheetMatchesTeam(name, t)) return t;
  }
  // Loose fallback: case-insensitive match against region/full name.
  const norm = String(name).toLowerCase().trim();
  return (
    leagueData.teams.find(
      (t) =>
        !t.disabled &&
        (String(t.region || '').toLowerCase() === norm ||
          getTeamName(t).toLowerCase() === norm)
    ) || null
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rankings')
    .setDescription('Show the most recent Top-25 rankings.')
    .addIntegerOption((o) =>
      o
        .setName('limit')
        .setDescription('How many to show (1-25, default 25)')
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const limit = interaction.options.getInteger('limit') ?? 25;

    const { rows, columnIndex } = await loadRankingsHistory();
    if (!rows) {
      return interaction.editReply('❌ Could not load the Rankings History sheet.');
    }

    const latest = findLatestColumn(rows, columnIndex);
    if (!latest) {
      return interaction.editReply('❌ No populated ranking column found.');
    }

    const entries = readRankingColumn(rows, latest, { limit });
    if (!entries.length) {
      return interaction.editReply(
        `❌ No teams found in the most recent column (${formatColumnLabel(latest)}).`
      );
    }

    const leagueData = getLatestLeagueData();
    const lines = entries.map((e) => `**${e.rank}.** ${e.name}`);

    const embed = new EmbedBuilder()
      .setTitle(`Top ${entries.length} — ${formatColumnLabel(latest)}`)
      .setColor(0x2980b9)
      .setDescription(lines.join('\n'))
      .setTimestamp();

    if (leagueData) {
      const topTeam = findTeamByName(leagueData, entries[0].name);
      if (topTeam) {
        const logo = getTeamLogoUrl(topTeam);
        if (logo) embed.setThumbnail(logo);
      }
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
