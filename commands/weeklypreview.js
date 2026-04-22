// ============================================================
//  commands/weeklypreview.js  —  Top matchups for the next
//  upcoming week of games.
//
//  Ranking formula:
//    score = (homeWinPct + awayWinPct) * 50
//            - |homeWinPct - awayWinPct| * 20     // smaller spread → better game
//            + P5 bonus (+10 if both P5, +4 if one P5)
//            + ranked-team bonus (trivial, optional)
//
//  We only care more about two 7-2 B1G teams than two 9-0 MAC
//  teams, so the P5 bias is intentionally light.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getCurrentSeason,
  getTeamMap,
  getLatestTeamSeason,
  getTeamName,
  getConferenceAbbrevFromName,
  safeNumber,
  formatRecord,
} = require('../utils/data');

// Power-5 cids in this league: ACC=0, B1G=1, B12=2, P12=3, SEC=4
const P5_CIDS = new Set([0, 1, 2, 3, 4]);

function teamRecord(team, currentSeason) {
  const seas = getLatestTeamSeason(team, currentSeason);
  if (!seas) return null;
  const wins = safeNumber(seas.won);
  const losses = safeNumber(seas.lost);
  const ties = safeNumber(seas.tied);
  const gp = wins + losses + ties;
  const winPct = gp > 0 ? (wins + ties * 0.5) / gp : 0;
  return { wins, losses, ties, gp, winPct };
}

function confAbbrev(leagueData, cid) {
  const confs =
    leagueData.confs ||
    (leagueData.gameAttributes && leagueData.gameAttributes.confs) ||
    [];
  const hit = confs.find((c) => c.cid === cid);
  if (!hit) return '';
  if (hit.abbrev) return hit.abbrev;
  return getConferenceAbbrevFromName(hit.name) || hit.name || '';
}

function p5Bonus(homeCid, awayCid) {
  const hP5 = P5_CIDS.has(homeCid);
  const aP5 = P5_CIDS.has(awayCid);
  if (hP5 && aP5) return 10;
  if (hP5 || aP5) return 4;
  return 0;
}

function scoreGame(homeRec, awayRec, homeCid, awayCid) {
  const combined = (homeRec.winPct + awayRec.winPct) * 50;
  const spread = Math.abs(homeRec.winPct - awayRec.winPct) * 20;
  const p5 = p5Bonus(homeCid, awayCid);
  return combined - spread + p5;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weeklypreview')
    .setDescription('Top 10 upcoming matchups, ranked by record + spread + slight P5 bias'),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData || !Array.isArray(leagueData.schedule) || !leagueData.schedule.length) {
      return interaction.editReply(
        '❌ No upcoming schedule found. The current export may be complete.'
      );
    }

    const currentSeason = getCurrentSeason(leagueData);
    const teamMap = getTeamMap(leagueData);

    // Find the next "week" (smallest day number remaining on schedule).
    const nextDay = leagueData.schedule
      .map((g) => safeNumber(g.day, Infinity))
      .reduce((min, d) => Math.min(min, d), Infinity);
    if (!Number.isFinite(nextDay)) {
      return interaction.editReply('❌ Could not determine the next week of games.');
    }

    const upcomingGames = leagueData.schedule.filter(
      (g) => safeNumber(g.day, Infinity) === nextDay
    );
    if (!upcomingGames.length) {
      return interaction.editReply('❌ No games found for the next week.');
    }

    const ranked = [];
    for (const g of upcomingGames) {
      const home = teamMap.get(g.homeTid);
      const away = teamMap.get(g.awayTid);
      if (!home || !away) continue;

      const homeRec = teamRecord(home, currentSeason);
      const awayRec = teamRecord(away, currentSeason);
      if (!homeRec || !awayRec) continue;

      const score = scoreGame(homeRec, awayRec, home.cid, away.cid);

      ranked.push({
        gid: g.gid,
        home,
        away,
        homeRec,
        awayRec,
        homeConf: confAbbrev(leagueData, home.cid),
        awayConf: confAbbrev(leagueData, away.cid),
        score,
      });
    }

    if (!ranked.length) {
      return interaction.editReply('❌ No previewable games this week.');
    }

    ranked.sort((a, b) => b.score - a.score);
    const top = ranked.slice(0, 10);

    const lines = top.map((m, idx) => {
      const awayName = getTeamName(m.away);
      const homeName = getTeamName(m.home);
      const awayRec = formatRecord(m.awayRec.wins, m.awayRec.losses, m.awayRec.ties);
      const homeRec = formatRecord(m.homeRec.wins, m.homeRec.losses, m.homeRec.ties);
      const awayTag = m.awayConf ? ` (${m.awayConf})` : '';
      const homeTag = m.homeConf ? ` (${m.homeConf})` : '';
      const matchup =
        `**${awayName}**${awayTag} ${awayRec}  @  ` +
        `**${homeName}**${homeTag} ${homeRec}`;
      return `\`${String(idx + 1).padStart(2)}.\` ${matchup}\n      Hype: **${m.score.toFixed(1)}**`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`📺 Weekly Preview — Day ${nextDay}`)
      .setColor(0x8e44ad)
      .setDescription(lines.join('\n\n'))
      .setFooter({
        text: `Ranked across ${ranked.length} upcoming game${ranked.length === 1 ? '' : 's'}. Slight P5 bias applied.`,
      })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
