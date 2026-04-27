// ============================================================
// commands/rankings.js
// Current Top 25 from the mock committee rankings sheet "Previous" tab.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { fetchSheetCsvCached } = require('../utils/sheetCache');
const { getLatestLeagueData, getTeamLogoUrl, getTeamName } = require('../utils/data');
const { matchesTeam: sheetMatchesTeam } = require('../utils/sheets');

const CURRENT_RANKINGS_SHEET_ID =
  process.env.CURRENT_RANKINGS_SHEET_ID ||
  '1aJif_Q2n6WJzwWpRCCQ-ofHoW7FfycbDnfADlAh682c';

const CURRENT_RANKINGS_TAB =
  process.env.CURRENT_RANKINGS_TAB || 'Previous';

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

function parseCurrentRankings(rows, limit = 25) {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const headerRow = rows[0] || [];
  const rankCol = headerRow.findIndex((cell) => String(cell || '').trim().toLowerCase() === 'rank');
  if (rankCol < 0) return null;

  let teamCol = rankCol > 0 ? rankCol - 1 : -1;
  if (teamCol < 0 || !String(headerRow[teamCol] || '').trim()) {
    teamCol = headerRow.findIndex((cell, index) => index !== rankCol && String(cell || '').trim());
  }
  if (teamCol < 0) return null;

  const label = String(headerRow[teamCol] || '').trim() || 'Current Rankings';
  const entries = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const teamName = String(row[teamCol] || '').trim();
    const rankValue = String(row[rankCol] || '').trim();

    if (!teamName && !rankValue) continue;
    if (!teamName || !/^\d{1,2}$/.test(rankValue)) break;

    const rank = Number(rankValue);
    if (rank < 1 || rank > 25) break;

    entries.push({ rank, name: teamName });
    if (entries.length >= limit) break;
  }

  if (!entries.length) return null;

  return { label, entries };
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

    let rows;
    try {
      rows = await fetchSheetCsvCached(CURRENT_RANKINGS_SHEET_ID, CURRENT_RANKINGS_TAB);
    } catch (error) {
      return interaction.editReply('❌ Could not load the current rankings sheet.');
    }

    const parsed = parseCurrentRankings(rows, limit);
    if (!parsed) {
      return interaction.editReply('❌ Could not parse the current rankings tab.');
    }

    const leagueData = getLatestLeagueData();
    const lines = parsed.entries.map((entry) => `**${entry.rank}.** ${entry.name}`);

    const embed = new EmbedBuilder()
      .setTitle(`Top ${parsed.entries.length} — ${parsed.label}`)
      .setColor(0x2980b9)
      .setDescription(lines.join('\n'))
      .setTimestamp();

    if (leagueData) {
      const topTeam = findTeamByName(leagueData, parsed.entries[0]?.name);
      if (topTeam) {
        const logo = getTeamLogoUrl(topTeam);
        if (logo) embed.setThumbnail(logo);
      }
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
