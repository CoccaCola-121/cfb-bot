// ============================================================
//  commands/ooc.js  — shows Open for unscheduled weeks
//  footer shows home/away games remaining to schedule
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData, getCurrentSeason, getTeamName } = require('../utils/data');
const { fetchSheetCsv, normalize, matchesTeam } = require('../utils/sheets');

const SHEET_ID =
  process.env.NZCFL_INFO_SHEET_ID ||
  process.env.GOOGLE_SHEET_ID ||
  '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';

// Each team has 2 home + 2 away OOC games per season
const HOME_OOC_TOTAL = 2;
const AWAY_OOC_TOTAL = 2;

function findYearColumn(rows, year) {
  const yearText = String(year).trim();
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const idx = rows[r].findIndex((c) => c.trim() === yearText);
    if (idx !== -1) return idx;
  }
  return -1;
}

function findWeekPairs(rows, yearCol) {
  const pairs = [];
  const seenWeeks = new Set();

  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    for (let c = yearCol; c < rows[r].length; c++) {
      const weekMatch = rows[r][c].match(/^Week\s+(\d+)$/i);
      if (!weekMatch) continue;
      const weekNum = Number(weekMatch[1]);
      if (seenWeeks.has(weekNum)) continue;

      for (let rr = r; rr < Math.min(r + 4, rows.length); rr++) {
        const left  = (rows[rr][c]   || '').trim().toLowerCase();
        const right = (rows[rr][c+1] || '').trim().toLowerCase();
        if (left === 'away' && right === 'home') {
          seenWeeks.add(weekNum);
          pairs.push({ week: weekNum, awayCol: c, homeCol: c + 1, dataStartRow: rr + 1 });
          break;
        }
      }
    }
  }

  return pairs.sort((a, b) => a.week - b.week);
}

// Returns { matchup, isHome, isAway } or null if team not on the sheet at all for this year
// Returns { matchup: 'Open', isHome: false, isAway: false } if team row found but no opponent yet
function findMatchup(rows, team, pair, yearCol) {
  // First check if this team appears anywhere in the year's columns at all
  let teamFoundInYear = false;

  for (let r = pair.dataStartRow; r < rows.length; r++) {
    const away = (rows[r][pair.awayCol] || '').trim();
    const home = (rows[r][pair.homeCol] || '').trim();

    // blank row — skip
    if (!away && !home) continue;

    if (matchesTeam(away, team)) {
      teamFoundInYear = true;
      if (home) return { matchup: `@ ${home}`, isHome: false, isAway: true };
      // away slot filled with team name but no opponent
      return { matchup: 'Open *(away slot — opponent TBD)*', isHome: false, isAway: true, isOpen: true };
    }

    if (matchesTeam(home, team)) {
      teamFoundInYear = true;
      if (away) return { matchup: `vs ${away}`, isHome: true, isAway: false };
      // home slot filled but no opponent
      return { matchup: 'Open *(home slot — opponent TBD)*', isHome: true, isAway: false, isOpen: true };
    }
  }

  return null; // team not found in this week's rows
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ooc')
    .setDescription("Show a team's out-of-conference schedule")
    .addStringOption((opt) =>
      opt.setName('team').setDescription('Team abbreviation, e.g. BUF').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName('year').setDescription('Year (defaults to current season + 1)').setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) return interaction.editReply('❌ No league data loaded.');

    const query      = interaction.options.getString('team').toUpperCase().trim();
    const currentSeason = Number(getCurrentSeason(leagueData));
    const targetYear = interaction.options.getInteger('year') || (currentSeason + 1);

    const team = leagueData.teams.find(
      (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === query
    );
    if (!team) return interaction.editReply(`❌ No active team found with abbreviation **${query}**.`);

    let rows;
    try {
      rows = await fetchSheetCsv(SHEET_ID, 'OOC');
    } catch (err) {
      console.error('ooc fetch error:', err);
      return interaction.editReply('❌ Failed to read the OOC sheet.');
    }

    const yearCol = findYearColumn(rows, targetYear);
    if (yearCol === -1)
      return interaction.editReply(`❌ Could not find **${targetYear}** on the OOC sheet.`);

    const weekPairs = findWeekPairs(rows, yearCol);
    if (!weekPairs.length)
      return interaction.editReply(`❌ Could not find OOC week columns for **${targetYear}**.`);

    const lines = [];
    let homeScheduled = 0;
    let awayScheduled = 0;

    for (const pair of weekPairs) {
      const result = findMatchup(rows, team, pair, yearCol);

      if (!result) {
        // Team has no row at all for this week — still show as Open
        lines.push(`Week ${pair.week} — *Open*`);
      } else if (result.isOpen) {
        lines.push(`Week ${pair.week} — *${result.matchup}*`);
        // Count the slot even though opponent TBD
        if (result.isHome) homeScheduled++;
        if (result.isAway) awayScheduled++;
      } else {
        lines.push(`Week ${pair.week} — ${result.matchup}`);
        if (result.isHome) homeScheduled++;
        if (result.isAway) awayScheduled++;
      }
    }

    if (!lines.length)
      return interaction.editReply(`No OOC schedule data found for **${getTeamName(team)}** in **${targetYear}**.`);

    const homeRemaining = Math.max(0, HOME_OOC_TOTAL - homeScheduled);
    const awayRemaining = Math.max(0, AWAY_OOC_TOTAL - awayScheduled);

    const remainingParts = [];
    if (homeRemaining > 0) remainingParts.push(`${homeRemaining} home`);
    if (awayRemaining > 0) remainingParts.push(`${awayRemaining} away`);

    const remainingStr = remainingParts.length
      ? `${remainingParts.join(' + ')} game${homeRemaining + awayRemaining !== 1 ? 's' : ''} still to schedule`
      : '✅ All 4 OOC games scheduled';

    const embed = new EmbedBuilder()
      .setTitle(`📅 ${getTeamName(team)} ${targetYear} OOC Schedule`)
      .setColor(0x0f4c81)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `OOC • NZCFL Info sheet  •  ${remainingStr}` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
