// ============================================================
// commands/rankingstats.js
// Stats-tab-only ranking summary
// Parses the repeated mini-table layout by header names
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
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
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasStrongTokenOverlap(a, b) {
  const aa = new Set(normalize(a).split(' ').filter(Boolean));
  const bb = new Set(normalize(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return false;

  let overlap = 0;
  for (const token of aa) {
    if (bb.has(token)) overlap += 1;
  }

  return overlap >= Math.min(2, aa.size, bb.size);
}

function teamMatchesCell(cellValue, team) {
  const cell = normalize(cellValue);
  if (!cell) return false;

  const variants = [
    team?.abbrev || '',
    team?.region || '',
    team?.name || '',
    getTeamName(team),
    `${team?.region || ''} ${team?.name || ''}`.trim(),
  ]
    .map(normalize)
    .filter(Boolean);

  if (variants.includes(cell)) return true;

  for (const v of variants) {
    if (!v) continue;
    if (cell === v) return true;
    if (cell.includes(v) || v.includes(cell)) return true;
    if (hasStrongTokenOverlap(cell, v)) return true;
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

function parseNumber(value) {
  const n = Number(String(value || '').trim());
  return Number.isFinite(n) ? n : null;
}

function findColumn(headers, matcher, startIndex = 0) {
  for (let i = startIndex; i < headers.length; i++) {
    if (matcher(headers[i], i)) return i;
  }
  return -1;
}

function findMetricBlocks(headers) {
  const h = headers.map((x) => normalize(x));

  const blocks = {
    totalWeeksRanked: null,
    consecutiveWeeksRanked: null,
    weeksRankedNumber1: null,
    totalWeeksTop10: null,
    bestStreakByTeam: null,
  };

  // Find "Team/Teams" + metric columns by nearby header text
  for (let i = 0; i < h.length; i++) {
    const cur = h[i];

    if ((cur === 'team' || cur === 'teams') && h[i + 1] === 'total weeks ranked') {
      blocks.totalWeeksRanked = {
        teamCol: i,
        valueCol: i + 1,
      };
    }

    if ((cur === 'team' || cur === 'teams') && h[i + 1] === 'consecutive weeks ranked') {
      blocks.consecutiveWeeksRanked = {
        teamCol: i,
        valueCol: i + 1,
        seasonsCol: h[i + 2] === 'seasons' ? i + 2 : -1,
      };
    }

    if ((cur === 'team' || cur === 'teams') && h[i + 1] === 'weeks ranked 1') {
      blocks.weeksRankedNumber1 = {
        teamCol: i,
        valueCol: i + 1,
      };
    }

    if (
      (cur === 'team' || cur === 'teams') &&
      h[i + 1] === 'total weeks ranked in top 10'
    ) {
      blocks.totalWeeksTop10 = {
        teamCol: i,
        valueCol: i + 1,
      };
    }

    if ((cur === 'team' || cur === 'teams') && h[i + 1] === 'best streak by team') {
      blocks.bestStreakByTeam = {
        teamCol: i,
        valueCol: i + 1,
        activeCol: h[i + 2] === 'is active' ? i + 2 : -1,
        seasonsCol: h[i + 3] === 'seasons' ? i + 3 : -1,
      };
    }
  }

  return blocks;
}

function parseStatsTab(rows, team) {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const headers = rows[0].map((c) => String(c || '').trim());
  const blocks = findMetricBlocks(headers);

  const result = {
    totalWeeksRanked: null,
    consecutiveWeeksRanked: null,
    consecutiveWeeksSeasons: null,
    weeksRankedNumber1: null,
    totalWeeksTop10: null,
    bestStreakByTeam: null,
    bestStreakActive: null,
    bestStreakSeasons: null,
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r].map((c) => String(c || '').trim());

    if (
      blocks.totalWeeksRanked &&
      teamMatchesCell(row[blocks.totalWeeksRanked.teamCol], team)
    ) {
      result.totalWeeksRanked = parseNumber(row[blocks.totalWeeksRanked.valueCol]);
    }

    if (
      blocks.consecutiveWeeksRanked &&
      teamMatchesCell(row[blocks.consecutiveWeeksRanked.teamCol], team)
    ) {
      result.consecutiveWeeksRanked = parseNumber(
        row[blocks.consecutiveWeeksRanked.valueCol]
      );
      if (blocks.consecutiveWeeksRanked.seasonsCol >= 0) {
        result.consecutiveWeeksSeasons = parseNumber(
          row[blocks.consecutiveWeeksRanked.seasonsCol]
        );
      }
    }

    if (
      blocks.weeksRankedNumber1 &&
      teamMatchesCell(row[blocks.weeksRankedNumber1.teamCol], team)
    ) {
      result.weeksRankedNumber1 = parseNumber(row[blocks.weeksRankedNumber1.valueCol]);
    }

    if (
      blocks.totalWeeksTop10 &&
      teamMatchesCell(row[blocks.totalWeeksTop10.teamCol], team)
    ) {
      result.totalWeeksTop10 = parseNumber(row[blocks.totalWeeksTop10.valueCol]);
    }

    if (
      blocks.bestStreakByTeam &&
      teamMatchesCell(row[blocks.bestStreakByTeam.teamCol], team)
    ) {
      result.bestStreakByTeam = parseNumber(row[blocks.bestStreakByTeam.valueCol]);

      if (blocks.bestStreakByTeam.activeCol >= 0) {
        const activeRaw = String(row[blocks.bestStreakByTeam.activeCol] || '').trim();
        result.bestStreakActive = activeRaw || null;
      }

      if (blocks.bestStreakByTeam.seasonsCol >= 0) {
        result.bestStreakSeasons = parseNumber(
          row[blocks.bestStreakByTeam.seasonsCol]
        );
      }
    }
  }

  const foundAnything = Object.values(result).some((v) => v !== null);
  return foundAnything ? result : null;
}

function fmtWithSeasons(weeks, seasons) {
  if (weeks === null) return '**0**';
  if (seasons === null) return `**${weeks}**`;
  return `**${weeks}** (${seasons} seasons)`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rankingstats')
    .setDescription("Show a team's historical ranking stats")
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation, e.g. OSU')
        .setRequired(true)
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

    const { rows } = await fetchStatsRows();
    if (!rows) {
      return interaction.editReply(
        '❌ Could not find a usable Stats tab on the rankings history sheet.'
      );
    }

    const stats = parseStatsTab(rows, team);
    if (!stats) {
      return interaction.editReply(
        `❌ No ranking stats found for **${getTeamName(team)}**.`
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(`Historical Ranking Stats — ${getTeamName(team)}`)
      .setColor(0xf39c12)
      .addFields(
        {
          name: 'All-Time Weeks Ranked',
          value: `**${stats.totalWeeksRanked ?? 0}**`,
          inline: true,
        },
        {
          name: 'All-Time Weeks in Top 10',
          value: `**${stats.totalWeeksTop10 ?? 0}**`,
          inline: true,
        },
        {
          name: 'All-Time Weeks at #1',
          value: `**${stats.weeksRankedNumber1 ?? 0}**`,
          inline: true,
        },
        {
          name: 'Consecutive Weeks Ranked',
          value: fmtWithSeasons(
            stats.consecutiveWeeksRanked ?? 0,
            stats.consecutiveWeeksSeasons
          ),
          inline: true,
        },
        {
          name: 'Best Streak by Team',
          value: fmtWithSeasons(
            stats.bestStreakByTeam ?? 0,
            stats.bestStreakSeasons
          ),
          inline: true,
        },
        {
          name: 'Best Streak Active?',
          value: `**${stats.bestStreakActive || '—'}**`,
          inline: true,
        }
      )
      .setTimestamp();

    const logo = getTeamLogoUrl(team);
    if (logo) {
      embed.setThumbnail(logo);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};