// ============================================================
// commands/rankhistory.js
// Pulls from Rankings History sheet tabs:
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

const HISTORICAL_TABS = [
  'Historical Data',
  'Rankings History - Historical Data',
  'Historical',
  'History',
];

const STATS_TABS = [
  'Stats',
  'Rankings History - Stats',
  'Ranking Stats',
  'Historical Stats',
];

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

function teamMatchesCell(cellValue, team) {
  const cell = normalize(cellValue);
  if (!cell) return false;

  const fullName = getTeamName(team);
  const region = team?.region || '';
  const name = team?.name || '';
  const abbrev = team?.abbrev || '';

  const variants = new Set([
    normalize(fullName),
    normalize(region),
    normalize(name),
    normalize(abbrev),
  ]);

  if (variants.has(cell)) return true;

  for (const v of variants) {
    if (!v) continue;
    if (cell === v) return true;
    if (v.includes(cell) && cell.length >= 5) return true;
    if (cell.includes(v) && v.length >= 5) return true;
  }

  return false;
}

async function fetchFirstWorkingTab(sheetId, tabNames) {
  for (const tab of tabNames) {
    try {
      const rows = await fetchSheetCsv(sheetId, tab);
      if (Array.isArray(rows) && rows.length > 1) {
        return { rows, tab };
      }
    } catch {
      // try next
    }
  }
  return { rows: null, tab: '' };
}

function detectRankColumn(rows) {
  if (!Array.isArray(rows) || rows.length < 3) return -1;

  const header = rows[0].map((c) => String(c || '').trim().toLowerCase());

  let idx = header.findIndex((h) => h === 'timeline' || h === 'rank' || h === '#');
  if (idx !== -1) return idx;

  for (let col = 0; col < Math.min(5, rows[0].length); col++) {
    let hits = 0;
    for (let row = 1; row < Math.min(rows.length, 30); row++) {
      const v = String(rows[row][col] || '').trim();
      if (/^\d+$/.test(v)) hits += 1;
    }
    if (hits >= 8) return col;
  }

  return -1;
}

function parsePeriodLabel(rawHeader, season) {
  const raw = String(rawHeader || '').trim();
  if (!raw) return null;

  let label = raw.replace(/\b20\d{2}\b/g, '').trim();
  label = label.replace(/^\d{2}\s+/, '').trim();

  if (/playoff/i.test(label)) return 'Playoffs';
  if (/preseason/i.test(label)) return 'Preseason';
  if (/^\(pre\)\s*week/i.test(label)) return label;
  if (/^week/i.test(label)) return label;
  if (/^ccg/i.test(label)) return 'CCG';

  if (season && raw.includes(String(season))) {
    return label || raw;
  }

  return label || raw;
}

function extractHistoricalEntries(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const header = rows[0];
  const rankCol = detectRankColumn(rows);
  if (rankCol === -1) return [];

  const entries = [];
  let currentSeason = null;

  for (let col = 0; col < header.length; col++) {
    if (col === rankCol) continue;

    const rawHeader = String(header[col] || '').trim();
    if (!rawHeader) continue;

    const seasonMatch = rawHeader.match(/\b(20\d{2})\b/);
    if (seasonMatch) {
      currentSeason = Number(seasonMatch[1]);
    }

    if (currentSeason === null) continue;

    const period = parsePeriodLabel(rawHeader, currentSeason);
    if (!period) continue;

    for (let row = 1; row < rows.length; row++) {
      const rankRaw = String(rows[row][rankCol] || '').trim();
      const teamRaw = String(rows[row][col] || '').trim();

      if (!/^\d+$/.test(rankRaw) || !teamRaw) continue;

      entries.push({
        season: currentSeason,
        period,
        rank: Number(rankRaw),
        team: teamRaw,
        colIndex: col,
      });
    }
  }

  return entries;
}

function computeAllTimeSummary(entries) {
  const sorted = [...entries].sort((a, b) => {
    if (a.colIndex !== b.colIndex) return a.colIndex - b.colIndex;
    return a.rank - b.rank;
  });

  let bestStreak = 0;
  let currentStreak = 0;
  let previousCol = null;

  for (const e of sorted) {
    if (previousCol === null || e.colIndex === previousCol + 1) {
      currentStreak += 1;
    } else {
      currentStreak = 1;
    }
    bestStreak = Math.max(bestStreak, currentStreak);
    previousCol = e.colIndex;
  }

  return {
    totalWeeksRanked: entries.length,
    weeksAtNumber1: entries.filter((e) => e.rank === 1).length,
    weeksTop10: entries.filter((e) => e.rank <= 10).length,
    peakRank: entries.length ? Math.min(...entries.map((e) => e.rank)) : null,
    bestStreak,
  };
}

function findNearestTeamColumn(headers, valueIndex) {
  for (let i = valueIndex - 1; i >= 0; i--) {
    const h = String(headers[i] || '').trim().toLowerCase();
    if (h === 'team' || h === 'teams' || h.startsWith('teams.')) {
      return i;
    }
  }
  return -1;
}

function lookupMetricInStats(rows, team, valueHeaderMatcher, extraHeaders = []) {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const headers = rows[0].map((h) => String(h || '').trim());
  const valueIndex = headers.findIndex((h) => valueHeaderMatcher.test(h));
  if (valueIndex === -1) return null;

  const teamIndex = findNearestTeamColumn(headers, valueIndex);
  if (teamIndex === -1) return null;

  const extraIndexes = extraHeaders.map((matcher) =>
    headers.findIndex((h) => matcher.test(h))
  );

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const teamCell = String(row[teamIndex] || '').trim();
    if (!teamMatchesCell(teamCell, team)) continue;

    const result = {
      value: String(row[valueIndex] || '').trim(),
    };

    extraHeaders.forEach((_, idx) => {
      const key = `extra${idx + 1}`;
      const col = extraIndexes[idx];
      result[key] = col >= 0 ? String(row[col] || '').trim() : '';
    });

    return result;
  }

  return null;
}

function overrideSummaryFromStats(rows, team, summary) {
  if (!rows || rows.length < 2) return summary;

  const totalWeeks = lookupMetricInStats(rows, team, /^Total Weeks Ranked$/i);
  const weeksAt1 = lookupMetricInStats(rows, team, /^Weeks Ranked #1$/i);
  const top10 = lookupMetricInStats(rows, team, /^Total Weeks Ranked In Top 10$/i);
  const streak = lookupMetricInStats(
    rows,
    team,
    /^Best Streak by Team$/i,
    [/^Is Active\?$/i, /^Seasons(?:\.\d+)?$/i]
  );

  return {
    ...summary,
    totalWeeksRanked: totalWeeks?.value ? Number(totalWeeks.value) || summary.totalWeeksRanked : summary.totalWeeksRanked,
    weeksAtNumber1: weeksAt1?.value ? Number(weeksAt1.value) || summary.weeksAtNumber1 : summary.weeksAtNumber1,
    weeksTop10: top10?.value ? Number(top10.value) || summary.weeksTop10 : summary.weeksTop10,
    bestStreak: streak?.value ? Number(streak.value) || summary.bestStreak : summary.bestStreak,
    bestStreakActive: streak?.extra1 || '',
    bestStreakSeasons: streak?.extra2 || '',
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

    const historicalFetch = await fetchFirstWorkingTab(SHEET_ID, HISTORICAL_TABS);
    if (!historicalFetch.rows) {
      return interaction.editReply(
        '❌ Could not find the rankings history sheet. Expected a tab like **Historical Data**.'
      );
    }

    const allEntries = extractHistoricalEntries(historicalFetch.rows);
    if (!allEntries.length) {
      return interaction.editReply(
        `❌ Could not parse ranking data from tab **${historicalFetch.tab}**.`
      );
    }

    const teamAllEntries = allEntries.filter((e) => teamMatchesCell(e.team, team));
    if (!teamAllEntries.length) {
      return interaction.editReply(
        `**${getTeamName(team)}** does not appear in the historical rankings sheet.`
      );
    }

    const seasonEntries = teamAllEntries
      .filter((e) => e.season === targetSeason)
      .sort((a, b) => a.colIndex - b.colIndex);

    if (!seasonEntries.length) {
      return interaction.editReply(
        `**${getTeamName(team)}** has no rankings logged for **${targetSeason}**.`
      );
    }

    let summary = computeAllTimeSummary(teamAllEntries);

    const statsFetch = await fetchFirstWorkingTab(SHEET_ID, STATS_TABS);
    if (statsFetch.rows) {
      summary = overrideSummaryFromStats(statsFetch.rows, team, summary);
    }

    const peakSeasonRank = Math.min(...seasonEntries.map((e) => e.rank));
    const lastSeenRank = seasonEntries[seasonEntries.length - 1]?.rank ?? null;

    const lines = seasonEntries.map((e) => {
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
          value: `**#${peakSeasonRank}**`,
          inline: true,
        },
        {
          name: 'Times Ranked This Season',
          value: `**${seasonEntries.length}**`,
          inline: true,
        },
        {
          name: 'Latest Rank',
          value: lastSeenRank ? `**#${lastSeenRank}**` : '—',
          inline: true,
        },
        {
          name: 'All-Time Weeks Ranked',
          value: `**${summary.totalWeeksRanked}**`,
          inline: true,
        },
        {
          name: 'All-Time Weeks at #1',
          value: `**${summary.weeksAtNumber1}**`,
          inline: true,
        },
        {
          name: 'All-Time Weeks in Top 10',
          value: `**${summary.weeksTop10}**`,
          inline: true,
        }
      )
      .setFooter({
        text: `History: ${historicalFetch.tab}${statsFetch.rows ? ` • Stats: ${statsFetch.tab}` : ''}`,
      })
      .setTimestamp();

    if (summary.bestStreak) {
      embed.addFields({
        name: 'Best Ranked Streak',
        value:
          `**${summary.bestStreak}**` +
          (summary.bestStreakActive ? ` • Active: **${summary.bestStreakActive}**` : '') +
          (summary.bestStreakSeasons ? ` • Seasons: **${summary.bestStreakSeasons}**` : ''),
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