// ============================================================
// commands/rankingstats.js
// Stats-tab-only ranking summary
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

function tokenSet(value) {
  return new Set(
    normalize(value)
      .split(' ')
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

function hasStrongTokenOverlap(a, b) {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return false;

  let overlap = 0;
  for (const t of ta) {
    if (tb.has(t)) overlap += 1;
  }

  return overlap >= Math.min(2, ta.size, tb.size);
}

function teamMatchesCell(cellValue, team) {
  const cell = normalize(cellValue);
  if (!cell) return false;

  const fullName = getTeamName(team);
  const region = team?.region || '';
  const name = team?.name || '';
  const abbrev = team?.abbrev || '';

  const variants = [
    fullName,
    region,
    name,
    abbrev,
    `${region} ${name}`.trim(),
  ]
    .map(normalize)
    .filter(Boolean);

  if (variants.includes(cell)) return true;

  for (const v of variants) {
    if (!v) continue;
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

function parseStatsTab(rows, team) {
  if (!Array.isArray(rows) || rows.length < 2) return null;

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

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i].map((c) => String(c || '').trim());

    // Total Weeks Ranked
    if (teamMatchesCell(row[3], team)) {
      result.totalWeeksRanked = parseNumber(row[4]);
    }

    // Consecutive Weeks Ranked
    if (teamMatchesCell(row[9], team)) {
      result.consecutiveWeeksRanked = parseNumber(row[10]);
      result.consecutiveWeeksSeasons = parseNumber(row[11]);
    }

    // Weeks Ranked #1
    if (teamMatchesCell(row[16], team)) {
      result.weeksRankedNumber1 = parseNumber(row[17]);
    }

    // Total Weeks Ranked In Top 10
    if (teamMatchesCell(row[22], team)) {
      result.totalWeeksTop10 = parseNumber(row[23]);
    }

    // Best Streak by Team
    if (teamMatchesCell(row[25], team)) {
      result.bestStreakByTeam = parseNumber(row[26]);
      result.bestStreakActive = String(row[27] || '').trim() || null;
      result.bestStreakSeasons = parseNumber(row[28]);
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