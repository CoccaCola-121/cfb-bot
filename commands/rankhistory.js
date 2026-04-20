// ============================================================
// commands/rankhistory.js
// Stats-tab-only version
// Pulls all-time ranking summary data from the Rankings History sheet
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getCurrentSeason,
  getTeamName,
  getTeamLogoUrl,
} = require('../utils/data');
const { fetchSheetCsv } = require('../utils/sheets');

const SHEET_ID =
  process.env.RANKINGS_HISTORY_SHEET_ID ||
  process.env.NZCFL_INFO_SHEET_ID ||
  process.env.GOOGLE_SHEET_ID ||
  '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

function teamMatchesCell(cellValue, team) {
  const cell = normalize(cellValue);
  if (!cell) return false;

  const variants = new Set([
    normalize(team?.abbrev || ''),
    normalize(team?.region || ''),
    normalize(team?.name || ''),
    normalize(getTeamName(team)),
  ]);

  if (variants.has(cell)) return true;

  for (const v of variants) {
    if (!v) continue;
    if (cell === v) return true;
    if (cell.includes(v) && v.length >= 4) return true;
    if (v.includes(cell) && cell.length >= 4) return true;
  }

  return false;
}

async function fetchStatsRows() {
  const tabsToTry = [
    'Stats',
    'Rankings History - Stats',
    'Ranking Stats',
    'Historical Stats',
  ];

  for (const tab of tabsToTry) {
    try {
      const rows = await fetchSheetCsv(SHEET_ID, tab);
      if (Array.isArray(rows) && rows.length > 1) {
        return { rows, tab };
      }
    } catch {
      // try next
    }
  }

  return { rows: null, tab: '' };
}

function parseStatsTab(rows, team) {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const result = {
    totalWeeksRanked: null,
    consecutiveWeeksRanked: null,
    consecutiveWeeksSeasons: '',
    weeksRankedNumber1: null,
    totalWeeksTop10: null,
    bestStreakByTeam: null,
    bestStreakActive: '',
    bestStreakSeasons: '',
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i].map((c) => String(c || '').trim());

    // Block 1: Total Weeks Ranked
    // cols: 3=team, 4=value
    if (teamMatchesCell(row[3], team)) {
      result.totalWeeksRanked = Number(row[4]) || 0;
    }

    // Block 2: Consecutive Weeks Ranked
    // cols: 9=team, 10=value, 11=seasons
    if (teamMatchesCell(row[9], team)) {
      result.consecutiveWeeksRanked = Number(row[10]) || 0;
      result.consecutiveWeeksSeasons = row[11] || '';
    }

    // Block 3: Weeks Ranked #1
    // cols: 16=team, 17=value
    if (teamMatchesCell(row[16], team)) {
      result.weeksRankedNumber1 = Number(row[17]) || 0;
    }

    // Block 4: Total Weeks Ranked In Top 10
    // cols: 22=team, 23=value
    if (teamMatchesCell(row[22], team)) {
      result.totalWeeksTop10 = Number(row[23]) || 0;
    }

    // Block 5: Best Streak by Team
    // cols: 25=team, 26=value, 27=active, 28=seasons
    if (teamMatchesCell(row[25], team)) {
      result.bestStreakByTeam = Number(row[26]) || 0;
      result.bestStreakActive = row[27] || '';
      result.bestStreakSeasons = row[28] || '';
    }
  }

  const foundAnything =
    result.totalWeeksRanked !== null ||
    result.consecutiveWeeksRanked !== null ||
    result.weeksRankedNumber1 !== null ||
    result.totalWeeksTop10 !== null ||
    result.bestStreakByTeam !== null;

  return foundAnything ? result : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rankhistory')
    .setDescription("Show a team's ranking history summary")
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation, e.g. OSU')
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('season')
        .setDescription('Unused for stats-only version')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const abbrev = interaction.options.getString('team').toUpperCase().trim();
    const team = leagueData.teams.find(
      (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === abbrev
    );

    if (!team) {
      return interaction.editReply(`❌ No active team with abbreviation **${abbrev}**.`);
    }

    const currentSeason = Number(getCurrentSeason(leagueData));

    const { rows, tab } = await fetchStatsRows();
    if (!rows) {
      return interaction.editReply(
        '❌ Could not find a usable **Stats** tab on the rankings history sheet.'
      );
    }

    const stats = parseStatsTab(rows, team);
    if (!stats) {
      return interaction.editReply(
        `❌ No ranking stats found for **${getTeamName(team)}** on tab **${tab}**.`
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${getTeamName(team)} — Ranking History`)
      .setColor(0xf39c12)
      .addFields(
        {
          name: 'All-Time Weeks Ranked',
          value: `**${stats.totalWeeksRanked ?? 0}**`,
          inline: true,
        },
        {
          name: 'All-Time Weeks at #1',
          value: `**${stats.weeksRankedNumber1 ?? 0}**`,
          inline: true,
        },
        {
          name: 'All-Time Weeks in Top 10',
          value: `**${stats.totalWeeksTop10 ?? 0}**`,
          inline: true,
        },
        {
          name: 'Best Streak by Team',
          value: `**${stats.bestStreakByTeam ?? 0}**`,
          inline: true,
        },
        {
          name: 'Best Streak Active?',
          value: `**${stats.bestStreakActive || '—'}**`,
          inline: true,
        },
        {
          name: 'Best Streak Seasons',
          value: stats.bestStreakSeasons
            ? `**${stats.bestStreakSeasons}**`
            : '—',
          inline: true,
        },
        {
          name: 'Consecutive Weeks Ranked',
          value: `**${stats.consecutiveWeeksRanked ?? 0}**`,
          inline: true,
        },
        {
          name: 'Consecutive Weeks Seasons',
          value: stats.consecutiveWeeksSeasons
            ? `**${stats.consecutiveWeeksSeasons}**`
            : '—',
          inline: true,
        },
        {
          name: 'Season',
          value: `**${currentSeason}**`,
          inline: true,
        }
      )
      .setFooter({ text: `Stats from tab: ${tab}` })
      .setTimestamp();

    const logo = getTeamLogoUrl(team);
    if (logo) {
      embed.setThumbnail(logo);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};