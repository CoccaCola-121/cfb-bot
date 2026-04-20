// ============================================================
// commands/rankhistory.js
// Reads directly from the real Rankings History sheet layouts:
// - Historical Data
// - Stats
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
    if (cell.includes(v) && v.length >= 5) return true;
    if (v.includes(cell) && cell.length >= 5) return true;
  }

  return false;
}

async function fetchFirstWorkingTab(sheetId, tabs) {
  for (const tab of tabs) {
    try {
      const rows = await fetchSheetCsv(sheetId, tab);
      if (Array.isArray(rows) && rows.length > 0) {
        return { rows, tab };
      }
    } catch {
      // try next
    }
  }
  return { rows: null, tab: '' };
}

function parseHistoricalData(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const header = rows[0].map((c) => String(c || '').trim());
  const timelineCol = header.findIndex((h) => h.toLowerCase() === 'timeline');

  if (timelineCol === -1) return [];

  const entries = [];

  for (let col = timelineCol + 1; col < header.length; col++) {
    const rawHeader = String(header[col] || '').trim();
    if (!rawHeader) continue;

    const seasonMatch = rawHeader.match(/\b(20\d{2})\b/);
    if (!seasonMatch) continue;

    const season = Number(seasonMatch[1]);
    const period = rawHeader.replace(String(season), '').trim();

    for (let row = 1; row < rows.length; row++) {
      const rankRaw = String(rows[row][timelineCol] || '').trim();
      const teamRaw = String(rows[row][col] || '').trim();

      if (!/^\d+$/.test(rankRaw)) continue;
      if (!teamRaw) continue;

      entries.push({
        season,
        period,
        rank: Number(rankRaw),
        team: teamRaw,
        colIndex: col,
      });
    }
  }

  return entries;
}

function sortSeasonEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.colIndex !== b.colIndex) return a.colIndex - b.colIndex;
    return a.rank - b.rank;
  });
}

function computeSummaryFromHistorical(entries) {
  const sorted = sortSeasonEntries(entries);

  let bestStreak = 0;
  let currentStreak = 0;
  let prevCol = null;

  for (const e of sorted) {
    if (prevCol === null || e.colIndex === prevCol + 1) {
      currentStreak += 1;
    } else {
      currentStreak = 1;
    }
    if (currentStreak > bestStreak) bestStreak = currentStreak;
    prevCol = e.colIndex;
  }

  return {
    totalWeeksRanked: entries.length,
    weeksAtNumber1: entries.filter((e) => e.rank === 1).length,
    weeksTop10: entries.filter((e) => e.rank <= 10).length,
    peakRank: entries.length ? Math.min(...entries.map((e) => e.rank)) : null,
    bestStreak,
  };
}

function parseStatsTab(rows, team) {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const stats = {
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

    if (teamMatchesCell(row[3], team)) {
      stats.totalWeeksRanked = Number(row[4]) || null;
    }

    if (teamMatchesCell(row[9], team)) {
      stats.consecutiveWeeksRanked = Number(row[10]) || null;
      stats.consecutiveWeeksSeasons = row[11] || null;
    }

    if (teamMatchesCell(row[16], team)) {
      stats.weeksRankedNumber1 = Number(row[17]) || null;
    }

    if (teamMatchesCell(row[22], team)) {
      stats.totalWeeksTop10 = Number(row[23]) || null;
    }

    if (teamMatchesCell(row[25], team)) {
      stats.bestStreakByTeam = Number(row[26]) || null;
      stats.bestStreakActive = row[27] || null;
      stats.bestStreakSeasons = row[28] || null;
    }
  }

  return stats;
}

function mergeSummary(historicalSummary, statsSummary) {
  if (!statsSummary) return historicalSummary;

  return {
    totalWeeksRanked:
      statsSummary.totalWeeksRanked ?? historicalSummary.totalWeeksRanked,
    weeksAtNumber1:
      statsSummary.weeksRankedNumber1 ?? historicalSummary.weeksAtNumber1,
    weeksTop10:
      statsSummary.totalWeeksTop10 ?? historicalSummary.weeksTop10,
    peakRank:
      historicalSummary.peakRank,
    bestStreak:
      statsSummary.bestStreakByTeam ?? historicalSummary.bestStreak,
    bestStreakActive:
      statsSummary.bestStreakActive || '',
    bestStreakSeasons:
      statsSummary.bestStreakSeasons || '',
    consecutiveWeeksRanked:
      statsSummary.consecutiveWeeksRanked,
    consecutiveWeeksSeasons:
      statsSummary.consecutiveWeeksSeasons || '',
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rankhistory')
    .setDescription("Show a team's AP poll ranking history")
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation, e.g. OSU')
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('season')
        .setDescription('Season year (default: current)')
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
    const targetSeason = interaction.options.getInteger('season') || currentSeason;

    const historicalFetch = await fetchFirstWorkingTab(SHEET_ID, [
      'Historical Data',
      'Rankings History - Historical Data',
      'Historical',
      'History',
    ]);

    if (!historicalFetch.rows) {
      return interaction.editReply(
        '❌ Could not find a usable **Historical Data** tab.'
      );
    }

    const allHistoricalEntries = parseHistoricalData(historicalFetch.rows);
    if (!allHistoricalEntries.length) {
      return interaction.editReply(
        `❌ Could not parse ranking data from tab **${historicalFetch.tab}**.`
      );
    }

    const teamAllEntries = allHistoricalEntries.filter((e) => teamMatchesCell(e.team, team));
    if (!teamAllEntries.length) {
      return interaction.editReply(
        `**${getTeamName(team)}** does not appear in the historical rankings data.`
      );
    }

    const teamSeasonEntries = sortSeasonEntries(
      teamAllEntries.filter((e) => e.season === targetSeason)
    );

    if (!teamSeasonEntries.length) {
      return interaction.editReply(
        `**${getTeamName(team)}** has no rankings logged for **${targetSeason}**.`
      );
    }

    const historicalSummary = computeSummaryFromHistorical(teamAllEntries);

    const statsFetch = await fetchFirstWorkingTab(SHEET_ID, [
      'Stats',
      'Rankings History - Stats',
      'Ranking Stats',
    ]);

    const statsSummary = statsFetch.rows ? parseStatsTab(statsFetch.rows, team) : null;
    const summary = mergeSummary(historicalSummary, statsSummary);

    const peakThisSeason = Math.min(...teamSeasonEntries.map((e) => e.rank));
    const latestRank = teamSeasonEntries[teamSeasonEntries.length - 1]?.rank ?? null;

    const lines = teamSeasonEntries.map((e) => {
      const emoji =
        e.rank === 1 ? '🥇' :
        e.rank <= 5 ? '🔥' :
        e.rank <= 10 ? '📈' :
        '📊';

      return `${emoji} **${e.period}:** #${e.rank}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${getTeamName(team)} — ${targetSeason} Rankings`)
      .setColor(0xf39c12)
      .setDescription(lines.join('\n'))
      .addFields(
        {
          name: 'Peak This Season',
          value: `**#${peakThisSeason}**`,
          inline: true,
        },
        {
          name: 'Times Ranked This Season',
          value: `**${teamSeasonEntries.length}**`,
          inline: true,
        },
        {
          name: 'Latest Rank',
          value: latestRank ? `**#${latestRank}**` : '—',
          inline: true,
        },
        {
          name: 'All-Time Weeks Ranked',
          value: `**${summary.totalWeeksRanked ?? 0}**`,
          inline: true,
        },
        {
          name: 'All-Time Weeks at #1',
          value: `**${summary.weeksAtNumber1 ?? 0}**`,
          inline: true,
        },
        {
          name: 'All-Time Weeks in Top 10',
          value: `**${summary.weeksTop10 ?? 0}**`,
          inline: true,
        }
      )
      .setFooter({
        text:
          `History: ${historicalFetch.tab}` +
          (statsFetch.rows ? ` • Stats: ${statsFetch.tab}` : ''),
      })
      .setTimestamp();

    if (summary.bestStreak) {
      let streakLine = `**${summary.bestStreak}**`;

      if (summary.bestStreakActive) {
        streakLine += ` • Active: **${summary.bestStreakActive}**`;
      }
      if (summary.bestStreakSeasons) {
        streakLine += ` • Seasons: **${summary.bestStreakSeasons}**`;
      }

      embed.addFields({
        name: 'Best Streak by Team',
        value: streakLine,
        inline: false,
      });
    }

    if (summary.consecutiveWeeksRanked) {
      let line = `**${summary.consecutiveWeeksRanked}**`;
      if (summary.consecutiveWeeksSeasons) {
        line += ` • Seasons: **${summary.consecutiveWeeksSeasons}**`;
      }

      embed.addFields({
        name: 'Consecutive Weeks Ranked',
        value: line,
        inline: false,
      });
    }

    const logo = getTeamLogoUrl(team);
    if (logo) {
      embed.setThumbnail(logo);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};