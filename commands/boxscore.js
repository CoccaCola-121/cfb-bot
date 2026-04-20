// ============================================================
//  commands/boxscore.js  — single game box score
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getGamesForCurrentSeason,
  getTeamMap,
  getTeamName,
  getTeamLogoUrl,
  safeNumber,
  getCurrentSeason,
} = require('../utils/data');

function findTeam(leagueData, abbrev) {
  return (leagueData.teams || []).find(
    (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === abbrev
  );
}

// Local week helper — the shared inferWeekFromGameDay adds +1 and was
// showing "Week 12" when the file was actually at Week 11. Use `day` directly.
function weekFromDay(day) {
  if (typeof day !== 'number' || Number.isNaN(day)) return null;
  return day;
}

function getLatestPosition(player) {
  const r = player?.ratings;
  if (Array.isArray(r) && r.length) return r[r.length - 1]?.pos || player.pos || '?';
  return player.pos || '?';
}

function computeQbRating(s) {
  const att = safeNumber(s.pss); if (att <= 0) return null;
  const cmp  = safeNumber(s.pssCmp), yds = safeNumber(s.pssYds);
  const td   = safeNumber(s.pssTD),  ints = safeNumber(s.pssInt);
  const clamp = (v) => Math.max(0, Math.min(2.375, v));
  const a = clamp(((cmp / att) - 0.3) * 5);
  const b = clamp(((yds / att) - 3) * 0.25);
  const c = clamp((td / att) * 20);
  const d = clamp(2.375 - ((ints / att) * 25));
  return ((a + b + c + d) / 6) * 100;
}

// Build team stats from either per-game teamSide.players OR season totals
function buildStatLists(teamSide, leagueData, season) {
  const tid    = teamSide.tid;
  const pgPlayers = Array.isArray(teamSide.players) ? teamSide.players : [];

  if (pgPlayers.length > 0) {
    // Match roster entries by pid only (no team-id fallback that caused
    // every player to show up as the first roster entry).
    const rosterByPid = new Map(
      (leagueData.players || []).map((pl) => [pl.pid, pl])
    );
    const mapName = (p) => {
      const roster = rosterByPid.get(p.pid);
      if (roster) return `${roster.firstName || ''} ${roster.lastName || ''}`.trim();
      return `Player ${p.pid ?? '?'}`;
    };
    const enrich = (p) => ({ ...p, displayName: mapName(p) });
    return {
      passers:   pgPlayers.filter((p) => safeNumber(p.pss) > 0).sort((a, b) => safeNumber(b.pssYds) - safeNumber(a.pssYds)).map(enrich),
      rushers:   pgPlayers.filter((p) => safeNumber(p.rus) > 0).sort((a, b) => safeNumber(b.rusYds) - safeNumber(a.rusYds)).map(enrich),
      receivers: pgPlayers.filter((p) => safeNumber(p.rec) > 0).sort((a, b) => safeNumber(b.recYds) - safeNumber(a.recYds)).map(enrich),
      fromGame:  true,
    };
  }

  const roster = (leagueData.players || []).filter((p) => p.tid === tid);
  const withStats = roster
    .map((p) => {
      const stats = (p.stats || []).find((s) => s.season === season && !s.playoffs);
      if (!stats) return null;
      return {
        displayName: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
        pos: getLatestPosition(p),
        pss: safeNumber(stats.pss), pssCmp: safeNumber(stats.pssCmp),
        pssYds: safeNumber(stats.pssYds), pssTD: safeNumber(stats.pssTD), pssInt: safeNumber(stats.pssInt),
        rus: safeNumber(stats.rus), rusYds: safeNumber(stats.rusYds), rusTD: safeNumber(stats.rusTD),
        rec: safeNumber(stats.rec), recYds: safeNumber(stats.recYds), recTD: safeNumber(stats.recTD),
      };
    })
    .filter(Boolean);

  return {
    passers:   withStats.filter((p) => p.pss > 0).sort((a, b) => b.pssYds - a.pssYds),
    rushers:   withStats.filter((p) => p.rus > 0).sort((a, b) => b.rusYds - a.rusYds),
    receivers: withStats.filter((p) => p.rec > 0).sort((a, b) => b.recYds - a.recYds),
    fromGame:  false,
  };
}

// Formatters — omit TD/INT lines when value is 0
function fmtPasser(p) {
  const cmp = p.pssCmp ?? '?', att = p.pss ?? '?';
  const qbr = computeQbRating(p);
  const td  = safeNumber(p.pssTD);
  const ints = safeNumber(p.pssInt);
  const tdStr   = td   > 0 ? `, ${td} TD`   : '';
  const intStr  = ints > 0 ? `, ${ints} INT` : '';
  const qbrStr  = qbr !== null ? ` | QBR **${qbr.toFixed(1)}**` : '';
  return `**${p.displayName || '?'}** — ${cmp}/${att}, **${p.pssYds}** yds${tdStr}${intStr}${qbrStr}`;
}
function fmtRusher(p) {
  const td = safeNumber(p.rusTD);
  const tdStr = td > 0 ? `, ${td} TD` : '';
  return `**${p.displayName || '?'}** — ${p.rus ?? '?'} att, **${p.rusYds}** yds${tdStr}`;
}
function fmtReceiver(p) {
  const td = safeNumber(p.recTD);
  const tdStr = td > 0 ? `, ${td} TD` : '';
  return `**${p.displayName || '?'}** — ${p.rec ?? '?'} rec, **${p.recYds}** yds${tdStr}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boxscore')
    .setDescription('Show box score for a team this season')
    .addStringOption((opt) =>
      opt.setName('team').setDescription('Team abbreviation, e.g. MSU').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName('week').setDescription('Week number (default: latest played week)').setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData?.games) return interaction.editReply('❌ No game data loaded.');

    const abbrev = interaction.options.getString('team').toUpperCase().trim();
    const team   = findTeam(leagueData, abbrev);
    if (!team) return interaction.editReply(`❌ No active team with abbreviation **${abbrev}**.`);

    const teamMap    = getTeamMap(leagueData);
    const season     = getCurrentSeason(leagueData);
    const allGames   = getGamesForCurrentSeason(leagueData);

    const teamGames = allGames.filter((g) =>
      (g.teams || []).some((t) => t.tid === team.tid) &&
      (g.teams || []).every((t) => typeof t.pts === 'number')
    );

    if (!teamGames.length)
      return interaction.editReply(`No completed games found for **${getTeamName(team)}** this season.`);

    const byWeek = new Map();
    for (const game of teamGames) {
      const week = weekFromDay(game.day);
      if (week === null) continue;
      if (!byWeek.has(week)) byWeek.set(week, []);
      byWeek.get(week).push(game);
    }

    const availWeeks    = [...byWeek.keys()].sort((a, b) => b - a);
    const requestedWeek = interaction.options.getInteger('week') ?? availWeeks[0];
    const games         = byWeek.get(requestedWeek);

    if (!games?.length)
      return interaction.editReply(
        `No completed game found for **${getTeamName(team)}** in Week ${requestedWeek}. ` +
        `Weeks with games: ${availWeeks.slice(0, 12).join(', ')}`
      );

    const game     = games[0];
    // FBGM: game.teams[0] = home, game.teams[1] = away
    const homeSide = game.teams?.[0];
    const awaySide = game.teams?.[1];
    if (!homeSide || !awaySide) return interaction.editReply('❌ Malformed game data.');

    const homeTeam = teamMap.get(homeSide.tid);
    const awayTeam = teamMap.get(awaySide.tid);

    const homePts = safeNumber(homeSide.pts);
    const awayPts = safeNumber(awaySide.pts);

    // Winner for the embed color — based on the requested team's result
    const teamSide = homeSide.tid === team.tid ? homeSide : awaySide;
    const oppSide  = homeSide.tid === team.tid ? awaySide : homeSide;
    const teamWon  = safeNumber(teamSide.pts) > safeNumber(oppSide.pts);

    const { passers,   rushers,   receivers,   fromGame } = buildStatLists(teamSide, leagueData, season);
    const { passers: oPas, rushers: oRus, receivers: oRec } = buildStatLists(oppSide, leagueData, season);

    const mk = (arr, fmt, max = 3) => arr.slice(0, max).map(fmt).join('\n') || '*—*';

    const noteStr = fromGame ? '' : '*⚠️ Per-game stats unavailable — showing season totals*';

    const homeName = getTeamName(homeTeam) || '?';
    const awayName = getTeamName(awayTeam) || '?';
    const teamName = getTeamName(team);
    const oppName  = teamSide === homeSide ? awayName : homeName;

    const embed = new EmbedBuilder()
      .setTitle(`Week ${requestedWeek} — ${awayName} ${awayPts} @ ${homePts} ${homeName}`)
      .setColor(teamWon ? 0x2ecc71 : 0xe74c3c);

    if (noteStr) embed.setDescription(noteStr);

    embed.addFields(
      { name: `${teamName} — Passing`,   value: mk(passers,   fmtPasser),   inline: false },
      { name: `${teamName} — Rushing`,   value: mk(rushers,   fmtRusher),   inline: false },
      { name: `${teamName} — Receiving`, value: mk(receivers, fmtReceiver), inline: false },
      { name: `${oppName} — Passing`,    value: mk(oPas, fmtPasser),        inline: false },
      { name: `${oppName} — Rushing`,    value: mk(oRus, fmtRusher),        inline: false },
      { name: `${oppName} — Receiving`,  value: mk(oRec, fmtReceiver),      inline: false },
    );

    embed
      .setFooter({ text: `Week ${requestedWeek} • Available weeks: ${availWeeks.slice(0, 10).join(', ')}` })
      .setTimestamp();

    // Both team logos: author icon = away team, thumbnail = home team
    const homeLogo = getTeamLogoUrl(homeTeam);
    const awayLogo = getTeamLogoUrl(awayTeam);
    if (awayLogo) {
      embed.setAuthor({ name: awayName, iconURL: awayLogo });
    }
    if (homeLogo) {
      embed.setThumbnail(homeLogo);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};