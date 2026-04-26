// ============================================================
//  commands/confoverview.js  —  Conference-wide snapshot.
//  Like /teamstats but aggregated over every team in a
//  conference (no recruiting data, just on-field performance).
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { normalize } = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');
const {
  getLatestLeagueData,
  getCurrentSeason,
  getLatestTeamSeason,
  getLatestTeamStats,
  getTeamName,
  findConferenceByAbbrev,
  getConferenceLogoUrl,
  safeNumber,
  formatRecord,
} = require('../utils/data');

const COACH_SHEET_ID  = process.env.NZCFL_COACH_SHEET_ID  || '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';
const COACH_SHEET_TAB = process.env.NZCFL_COACH_SHEET_TAB || 'Coach';

// Count distinct teams in the conference that have a listed coach on the
// NZCFL Info → Coach sheet. Returns null if the sheet can't be fetched.
async function countCoachedTeams(leagueData, confCid) {
  try {
    const rows = await fetchSheetCsv(COACH_SHEET_ID, COACH_SHEET_TAB);
    if (!Array.isArray(rows) || !rows.length) return null;

    // Same header logic used in /coachleaderboard.
    let hi = -1;
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      if (rows[i].some(c => {
        const s = String(c || '').toLowerCase();
        return s.includes('coach') && s !== 'coach rankings';
      })) {
        hi = i;
        break;
      }
    }
    if (hi === -1) hi = 1;

    // Build a normalized set of identifiers for every team in this conference.
    const confTeams = (leagueData.teams || []).filter(
      (t) => !t.disabled && t.cid === confCid
    );
    const confTeamKeys = new Set();
    for (const t of confTeams) {
      [getTeamName(t), t.region, t.name, t.abbrev]
        .map((x) => normalize(x || ''))
        .filter(Boolean)
        .forEach((k) => confTeamKeys.add(k));
    }

    // Each row has a team in column 1 and coach in column 0. Count rows
    // whose team name matches any identifier for a conference team.
    const coachedTeamKeys = new Set();
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const coach = String(r[0] || '').trim();
      const team  = String(r[1] || '').trim();
      if (!coach || !team) continue;
      const tn = normalize(team);
      if (confTeamKeys.has(tn)) coachedTeamKeys.add(tn);
    }
    return coachedTeamKeys.size;
  } catch {
    return null;
  }
}

function buildTeamRow(team, currentSeason) {
  const seas = getLatestTeamSeason(team, currentSeason);
  const stats = getLatestTeamStats(team, currentSeason, false);
  if (!seas || !stats) return null;

  const wins = safeNumber(seas.won);
  const losses = safeNumber(seas.lost);
  const ties = safeNumber(seas.tied);
  const gp = safeNumber(stats.gp, wins + losses + ties);
  if (gp <= 0) return null;

  const pts = safeNumber(stats.pts);
  const oppPts = safeNumber(stats.oppPts);

  return {
    tid: team.tid,
    abbrev: team.abbrev,
    name: getTeamName(team),
    wins,
    losses,
    ties,
    wonConf: safeNumber(seas.wonConf),
    lostConf: safeNumber(seas.lostConf),
    tiedConf: safeNumber(seas.tiedConf),
    gp,
    ppg: pts / gp,
    papg: oppPts / gp,
    pssYds: safeNumber(stats.pssYds),
    rusYds: safeNumber(stats.rusYds),
    sacks: safeNumber(stats.defSk),
    takeaways: safeNumber(stats.defInt) + safeNumber(stats.defFmbRec),
    winPct: gp > 0 ? (wins + ties * 0.5) / gp : 0,
  };
}

function leaderBy(rows, key, { ascending = false } = {}) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) =>
    ascending ? a[key] - b[key] : b[key] - a[key]
  );
  return sorted[0];
}

function avg(rows, key) {
  if (!rows.length) return 0;
  return rows.reduce((sum, r) => sum + r[key], 0) / rows.length;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('confoverview')
    .setDescription('Conference-wide team stats summary')
    .addStringOption((opt) =>
      opt
        .setName('conference')
        .setDescription('Conference abbreviation')
        .setRequired(true)
        .addChoices(
          { name: 'ACC', value: 'ACC' },
          { name: 'B1G', value: 'B1G' },
          { name: 'B12', value: 'B12' },
          { name: 'P12', value: 'P12' },
          { name: 'SEC', value: 'SEC' },
          { name: 'MW', value: 'MW' },
          { name: 'MAC', value: 'MAC' },
          { name: 'C-USA', value: 'C-USA' },
          { name: 'AAC', value: 'AAC' },
          { name: 'SUN', value: 'SUN' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData || !leagueData.teams) {
      return interaction.editReply('❌ No league data loaded. Ask a mod to run `/loadweek`.');
    }

    const confAbbrev = interaction.options.getString('conference');
    const conf = findConferenceByAbbrev(leagueData, confAbbrev);
    if (!conf) {
      return interaction.editReply(`❌ Could not find conference **${confAbbrev}**.`);
    }

    const currentSeason = getCurrentSeason(leagueData);

    const confTeams = (leagueData.teams || []).filter(
      (t) => !t.disabled && t.cid === conf.cid
    );
    if (!confTeams.length) {
      return interaction.editReply(`❌ No active teams found in **${confAbbrev}**.`);
    }

    const rows = confTeams
      .map((team) => buildTeamRow(team, currentSeason))
      .filter(Boolean);
    if (!rows.length) {
      return interaction.editReply(`❌ No current-season data for **${confAbbrev}**.`);
    }

    // Top 3 by win%, ties broken by conf record then PPG.
    const topThree = [...rows]
      .sort((a, b) => {
        if (b.winPct !== a.winPct) return b.winPct - a.winPct;
        const aConfPct = (a.wonConf + a.tiedConf * 0.5) /
          Math.max(1, a.wonConf + a.lostConf + a.tiedConf);
        const bConfPct = (b.wonConf + b.tiedConf * 0.5) /
          Math.max(1, b.wonConf + b.lostConf + b.tiedConf);
        if (bConfPct !== aConfPct) return bConfPct - aConfPct;
        return b.ppg - a.ppg;
      })
      .slice(0, 3);

    const bestOffense     = leaderBy(rows, 'ppg');
    const bestDefense     = leaderBy(rows, 'papg', { ascending: true });
    const bestPassing     = leaderBy(rows, 'pssYds');
    const bestRushing     = leaderBy(rows, 'rusYds');
    const bestSacks       = leaderBy(rows, 'sacks');
    const bestTakeaways   = leaderBy(rows, 'takeaways');

    const leaderBoardLines = topThree.map((r, i) => {
      const rank = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
      return `${rank} **${r.name}** (${r.abbrev}) — ${formatRecord(r.wins, r.losses, r.ties)} · Conf ${formatRecord(r.wonConf, r.lostConf, r.tiedConf)}`;
    });

    const offenseLines = [
      `Best Offense: **${bestOffense.name}** — ${bestOffense.ppg.toFixed(1)} PPG`,
      `Most Pass Yds: **${bestPassing.name}** — ${bestPassing.pssYds}`,
      `Most Rush Yds: **${bestRushing.name}** — ${bestRushing.rusYds}`,
    ];

    const defenseLines = [
      `Best Defense: **${bestDefense.name}** — ${bestDefense.papg.toFixed(1)} PAPG`,
      `Most Sacks: **${bestSacks.name}** — ${bestSacks.sacks}`,
      `Most Takeaways: **${bestTakeaways.name}** — ${bestTakeaways.takeaways}`,
    ];

    const avgLines = [
      `Avg PPG: **${avg(rows, 'ppg').toFixed(1)}**  •  Avg PAPG: **${avg(rows, 'papg').toFixed(1)}**`,
      `Avg Pass Yds: **${avg(rows, 'pssYds').toFixed(0)}**  •  Avg Rush Yds: **${avg(rows, 'rusYds').toFixed(0)}**`,
    ];

    const coachedCount = await countCoachedTeams(leagueData, conf.cid);
    const coachValue =
      coachedCount === null
        ? 'Coach sheet unavailable'
        : `**${coachedCount}** of **${rows.length}** teams have a listed head coach`;

    const embed = new EmbedBuilder()
      .setTitle(`🏟️ ${confAbbrev} — Conference Overview`)
      .setColor(0x16a085)
      .addFields(
        {
          name: '🏆 Top Teams',
          value: leaderBoardLines.join('\n'),
          inline: false,
        },
        {
          name: '⚔️ Offense Leaders',
          value: offenseLines.join('\n'),
          inline: false,
        },
        {
          name: '🛡️ Defense Leaders',
          value: defenseLines.join('\n'),
          inline: false,
        },
        {
          name: '📊 Conference Averages',
          value: avgLines.join('\n'),
          inline: false,
        },
        {
          name: '🧢 Coaching',
          value: coachValue,
          inline: false,
        }
      )
      .setFooter({ text: 'Aggregated from latest Football GM export' })
      .setTimestamp();

    const logo = getConferenceLogoUrl(leagueData, confAbbrev);
    if (logo) embed.setThumbnail(logo);

    return interaction.editReply({ embeds: [embed] });
  },
};
