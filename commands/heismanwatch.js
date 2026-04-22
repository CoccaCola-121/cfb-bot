// ============================================================
//  commands/heismanwatch.js  —  Top 10 Heisman contenders
//
//  Heisman Score formula (intentionally offensive-heavy, with a
//  team-success multiplier — this mirrors how real voters favor
//  high-volume QBs/RBs/WRs on winning teams). Rushing & receiving
//  are weighted slightly higher than pure passing so skill players
//  can actually crack the top 10.
//
//    passing : pssYds*0.10 + pssTD*10 − pssInt*15
//    rushing : rusYds*0.28 + rusTD*15
//    receiv. : recYds*0.24 + recTD*14 + rec*1.2
//    team    : + (teamWinPct * 150)
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getCurrentSeason,
  getTeamMap,
  getLatestPlayerStats,
  getLatestPosition,
  getLatestTeamSeason,
  safeNumber,
} = require('../utils/data');

function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '?';
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  switch (num % 10) {
    case 1: return `${num}st`;
    case 2: return `${num}nd`;
    case 3: return `${num}rd`;
    default: return `${num}th`;
  }
}

function computeHeismanScore(stats, teamWinPct) {
  const pssYds = safeNumber(stats.pssYds);
  const pssTD  = safeNumber(stats.pssTD);
  const pssInt = safeNumber(stats.pssInt);

  const rusYds = safeNumber(stats.rusYds);
  const rusTD  = safeNumber(stats.rusTD);

  const recYds = safeNumber(stats.recYds);
  const recTD  = safeNumber(stats.recTD);
  const rec    = safeNumber(stats.rec);

  const passScore = pssYds * 0.10 + pssTD * 10 - pssInt * 15;
  const rushScore = rusYds * 0.28 + rusTD * 15;
  const recScore  = recYds * 0.24 + recTD * 14 + rec * 1.2;
  const teamBonus = (Number.isFinite(teamWinPct) ? teamWinPct : 0) * 150;

  return passScore + rushScore + recScore + teamBonus;
}

// Build a "stat line" string that highlights a player's most relevant box.
function describePlayerStats(pos, stats) {
  const pssYds = safeNumber(stats.pssYds);
  const pssTD  = safeNumber(stats.pssTD);
  const pssInt = safeNumber(stats.pssInt);
  const rusYds = safeNumber(stats.rusYds);
  const rusTD  = safeNumber(stats.rusTD);
  const recYds = safeNumber(stats.recYds);
  const recTD  = safeNumber(stats.recTD);
  const rec    = safeNumber(stats.rec);

  if (pos === 'QB') {
    const parts = [`${pssYds} pass yds, ${pssTD} TD, ${pssInt} INT`];
    if (rusYds > 50 || rusTD > 0) parts.push(`${rusYds} rush yds, ${rusTD} TD`);
    return parts.join('  •  ');
  }

  if (['RB', 'HB', 'FB'].includes(pos)) {
    const parts = [`${rusYds} rush yds, ${rusTD} TD`];
    if (recYds > 50 || recTD > 0) parts.push(`${rec} rec, ${recYds} yds, ${recTD} TD`);
    return parts.join('  •  ');
  }

  if (['WR', 'TE'].includes(pos)) {
    return `${rec} rec, ${recYds} yds, ${recTD} TD`;
  }

  // Fallback: include whichever line has production.
  const lines = [];
  if (pssYds > 0 || pssTD > 0 || pssInt > 0) {
    lines.push(`${pssYds} pass yds, ${pssTD} TD, ${pssInt} INT`);
  }
  if (rusYds > 0 || rusTD > 0) lines.push(`${rusYds} rush yds, ${rusTD} TD`);
  if (recYds > 0 || recTD > 0) lines.push(`${rec} rec, ${recYds} yds, ${recTD} TD`);
  return lines.join('  •  ') || '—';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('heismanwatch')
    .setDescription('Top 10 Heisman contenders by stat-driven formula with team-success bonus'),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData || !Array.isArray(leagueData.players)) {
      return interaction.editReply('❌ No league data loaded. Ask a mod to run `/loadweek`.');
    }

    const currentSeason = getCurrentSeason(leagueData);
    const teamMap = getTeamMap(leagueData);

    // Pre-compute each team's current-season win% once.
    const teamWinPctByTid = new Map();
    for (const team of leagueData.teams || []) {
      if (team.disabled) continue;
      const seas = getLatestTeamSeason(team, currentSeason);
      if (!seas) continue;
      const w = safeNumber(seas.won);
      const l = safeNumber(seas.lost);
      const t = safeNumber(seas.tied);
      const gp = w + l + t;
      teamWinPctByTid.set(team.tid, gp > 0 ? (w + t * 0.5) / gp : 0);
    }

    const candidates = [];

    for (const player of leagueData.players) {
      // Only real-roster players on current teams.
      if (typeof player.tid !== 'number' || player.tid < 0) continue;

      const pos = getLatestPosition(player);
      // Heisman is overwhelmingly offensive — filter to skill / QB positions.
      if (!['QB', 'RB', 'HB', 'FB', 'WR', 'TE'].includes(pos)) continue;

      const stats = getLatestPlayerStats(player, currentSeason, false);
      if (!stats) continue;

      // Require some production to avoid leaderboard clutter.
      const pssYds = safeNumber(stats.pssYds);
      const rusYds = safeNumber(stats.rusYds);
      const recYds = safeNumber(stats.recYds);
      if (pssYds + rusYds + recYds < 100) continue;

      const teamWinPct = teamWinPctByTid.get(player.tid) ?? 0;
      const score = computeHeismanScore(stats, teamWinPct);

      candidates.push({
        player,
        pos,
        stats,
        score,
        teamWinPct,
      });
    }

    if (!candidates.length) {
      return interaction.editReply('No Heisman-caliber stat lines found in the current export.');
    }

    candidates.sort((a, b) => b.score - a.score);
    const top10 = candidates.slice(0, 10);

    const lines = top10.map((c, idx) => {
      const p = c.player;
      const team = teamMap.get(p.tid);
      const teamStr = team ? `${team.abbrev}` : 'FA';
      const name = `${p.firstName || ''} ${p.lastName || ''}`.trim();
      const statLine = describePlayerStats(c.pos, c.stats);
      const recordBadge = `${Math.round(c.teamWinPct * 100)}% team W%`;

      return (
        `\`${String(idx + 1).padStart(2)}.\` **${name}** — ${c.pos} · ${teamStr}\n` +
        `      ${statLine}\n` +
        `      Score: **${c.score.toFixed(1)}**  •  ${recordBadge}`
      );
    });

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Heisman Watch — ${ordinal(10)} place and up`)
      .setColor(0xf1c40f)
      .setDescription(lines.join('\n\n'))
      .setFooter({
        text:
          'Score = passing + rushing + receiving value, plus team-success bonus (winners get a boost).',
      })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
