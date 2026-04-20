// ============================================================
//  commands/rankhistory.js — tries many tab name patterns
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData, getCurrentSeason, getTeamName, getTeamLogoUrl } = require('../utils/data');
const { fetchSheetCsv, normalize, matchesTeam } = require('../utils/sheets');

const SHEET_ID = process.env.NZCFL_INFO_SHEET_ID || process.env.GOOGLE_SHEET_ID || '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';

// ── Try to find and parse a rankings tab ─────────────────────
// The sheet might use any of these structures:
//
// A) Columnar: Year/Week | Rank | Team  (one entry per row)
// B) Poll grid: col headers = Week 1, Week 2...  row headers = rank 1,2,3...
// C) Flat: just Team | Rank  (no week info)

function tryParseColumnar(rows) {
  // Look for header row containing rank + team
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const r = rows[i].map((c) => c.toLowerCase().trim());
    if (r.some((c) => c.includes('rank') || c === 'rk') && r.some((c) => c === 'team' || c === 'school')) {
      hi = i; break;
    }
  }
  if (hi === -1) return null;

  const header   = rows[hi].map((c) => c.toLowerCase().trim());
  const weekCol  = header.findIndex((h) => h === 'week' || h === 'wk' || h === 'period');
  const rankCol  = header.findIndex((h) => h.includes('rank') || h === 'rk' || h === '#');
  const teamCol  = header.findIndex((h) => h === 'team' || h === 'school');

  if (rankCol === -1 || teamCol === -1) return null;

  const data = rows.slice(hi + 1)
    .map((row) => ({
      week: weekCol >= 0 ? String(row[weekCol] || '').trim() : '?',
      rank: String(row[rankCol] || '').trim(),
      team: String(row[teamCol] || '').trim(),
    }))
    .filter((r) => r.rank && r.team && !isNaN(Number(r.rank)));

  return data.length ? data : null;
}

function tryParsePollGrid(rows) {
  // Row 0 = week headers: "", "Week 1", "Week 2", ...
  // Row 1+ = rank: 1, Team, Team, ...
  const header = rows[0] || [];
  const weekPattern = /week\s*\d+/i;
  if (!header.some((h) => weekPattern.test(h))) return null;

  const data = [];
  for (let row = 1; row < rows.length; row++) {
    const rank = rows[row][0];
    if (!rank || isNaN(Number(rank))) continue;
    for (let col = 1; col < rows[row].length; col++) {
      const teamName  = String(rows[row][col] || '').trim();
      const weekLabel = String(header[col] || `Week ${col}`).trim();
      if (teamName) data.push({ week: weekLabel, rank: String(rank).trim(), team: teamName });
    }
  }
  return data.length ? data : null;
}

function tryParseFlat(rows) {
  // Simple: find rank + team columns, no week info
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i].map((c) => c.toLowerCase().trim());
    if (r.some((c) => c === 'team' || c === 'school')) { hi = i; break; }
  }
  if (hi === -1) hi = 0;

  const header  = rows[hi].map((c) => c.toLowerCase().trim());
  const rankCol = header.findIndex((h) => h === 'rank' || h === '#' || h === 'rk');
  const teamCol = header.findIndex((h) => h === 'team' || h === 'school');
  if (teamCol === -1) return null;

  const data = rows.slice(hi + 1)
    .map((row, idx) => ({
      week:  'Overall',
      rank:  String(rankCol >= 0 ? (row[rankCol] || idx + 1) : idx + 1).trim(),
      team:  String(row[teamCol] || '').trim(),
    }))
    .filter((r) => r.team && !isNaN(Number(r.rank)));

  return data.length ? data : null;
}

function parseRankingRows(rows) {
  return tryParseColumnar(rows) || tryParsePollGrid(rows) || tryParseFlat(rows) || [];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rankhistory')
    .setDescription("Show a team's AP poll ranking history")
    .addStringOption((opt) =>
      opt.setName('team').setDescription('Team abbreviation, e.g. OSU').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName('season').setDescription('Season year (default: current)').setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) return interaction.editReply('❌ No league data loaded.');

    const abbrev = interaction.options.getString('team').toUpperCase().trim();
    const team   = leagueData.teams.find(
      (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === abbrev
    );
    if (!team) return interaction.editReply(`❌ No active team with abbreviation **${abbrev}**.`);

    const currentSeason = Number(getCurrentSeason(leagueData));
    const targetSeason  = interaction.options.getInteger('season') || currentSeason;

    // Try multiple tab name patterns
    const tabsToTry = [
      `${targetSeason} Rankings`,
      `${targetSeason} AP`,
      `${targetSeason} Poll`,
      `AP ${targetSeason}`,
      'Rankings',
      'AP Poll',
      'AP Rankings',
      'Poll',
      'AP',
      'Polls',
    ];

    let rows = null, usedTab = '';
    for (const tab of tabsToTry) {
      try {
        const r = await fetchSheetCsv(SHEET_ID, tab);
        if (r.length > 1) { rows = r; usedTab = tab; break; }
      } catch { /* try next */ }
    }

    if (!rows || rows.length <= 1)
      return interaction.editReply(
        `❌ No rankings tab found. Expected tab names like **"${targetSeason} Rankings"**, **"AP Poll"**, or **"Rankings"** on the NZCFL Info sheet.`
      );

    const data = parseRankingRows(rows);
    if (!data.length)
      return interaction.editReply(`❌ Could not parse ranking data from tab **${usedTab}**.`);

    // Filter for this team
    const teamEntries = data.filter((d) => matchesTeam(d.team, team));
    if (!teamEntries.length)
      return interaction.editReply(
        `**${getTeamName(team)}** does not appear in the rankings on tab **${usedTab}**.`
      );

    // Sort by week number if possible
    teamEntries.sort((a, b) => {
      const wa = parseInt(a.week.replace(/\D/g, '')) || 0;
      const wb = parseInt(b.week.replace(/\D/g, '')) || 0;
      return wa - wb;
    });

    const peakRank    = Math.min(...teamEntries.map((e) => Number(e.rank)));
    const weeksRanked = teamEntries.length;

    const lines = teamEntries.map((e) => {
      const r     = Number(e.rank);
      const emoji = r === 1 ? '🥇' : r <= 5 ? '🔥' : r <= 10 ? '📈' : '📊';
      const wk    = e.week !== 'Overall' ? `**${e.week}:**` : '**Ranked:**';
      return `${emoji} ${wk} #${e.rank}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${getTeamName(team)} — ${targetSeason} Rankings`)
      .setColor(0xf39c12)
      .setDescription(lines.join('\n'))
      .addFields(
        { name: '🏆 Peak Rank',    value: `**#${peakRank}**`,    inline: true },
        { name: '📅 Times Ranked', value: `**${weeksRanked}**`,  inline: true },
      )
      .setFooter({ text: `Rankings from tab: ${usedTab}` })
      .setTimestamp();

    const logo = getTeamLogoUrl(team);
    if (logo) embed.setThumbnail(logo);

    return interaction.editReply({ embeds: [embed] });
  },
};
