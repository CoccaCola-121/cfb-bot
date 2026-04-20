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
  inferWeekFromGameDay,
  safeNumber,
  getCurrentSeason,
} = require('../utils/data');

function findTeam(leagueData, abbrev) {
  return (leagueData.teams || []).find(
    (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === abbrev
  );
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

  // Per-game player stats present (Football GM sometimes includes these)
  if (pgPlayers.length > 0) {
    // FIXED: only match by pid. Never fall back to team-id which mapped
    // every player to the first roster entry (hence "Ronald Barlow x3" bug).
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

  // Fall back to season totals for this team's roster
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

function fmtPasser(p) {
  const cmp = p.pssCmp ?? '?', att = p.pss ?? '?';
  const qbr = computeQbRating(p);
  const qbrStr = qbr !== null ? ` | QBR **${qbr.toFixed(1)}**` : '';
  return `**${p.displayName || '?'}** — ${cmp}/${att}, **${p.pssYds}** yds, ${p.pssTD} TD, ${p.pssInt} INT${qbrStr}`;
}
function fmtRusher(p) {
  return `**${p.displayName || '?'}** — ${p.rus ?? '?'} att, **${p.rusYds}** yds, ${p.rusTD} TD`;
}
function fmtReceiver(p) {
  return `**${p.displayName || '?'}** — ${p.rec ?? '?'} rec, **${p.recYds}** yds, ${p.recTD} TD`;
}

function buildScoreLine(teamSide) {
  const pts = teamSide.pts ?? '?';
  const q   = teamSide.ptsQtrs;
  if (!Array.isArray(q) || !q.length) return `**${pts}**`;
  const labels = q.map((pt, i) => i < 4 ? `Q${i+1}: ${pt}` : `OT${i-3}: ${pt}`);
  return `**${pts}** *(${labels.join(', ')})*`;
}

// ── Scoring summary ──────────────────────────────────────────
//
// FBGM games usually have a `scoringSummary` array. Each entry is a play
// with a team index (t: 0 or 1), quarter, text, type, and sometimes clock.
// This function pulls that out and renders a compact summary grouped by quarter.
function buildScoringSummary(game, teamA, teamB) {
  const summary = Array.isArray(game.scoringSummary) ? game.scoringSummary : [];
  if (!summary.length) return null;

  const teamAbbrevByIdx = [
    (teamA?.abbrev || 'A').toUpperCase(),
    (teamB?.abbrev || 'B').toUpperCase(),
  ];

  // Track running score per team as we walk through plays
  let score = [0, 0];

  const lines = [];
  let lastQuarter = null;

  const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  for (const play of summary) {
    if (play.hide) continue;
    const tIdx   = typeof play.t === 'number' ? play.t : 0;
    const quarter = play.quarter ?? play.qtr ?? null;

    // Guess point value from the type field (FBGM standard types)
    const type = String(play.type || '').toUpperCase();
    let pts = 0;
    if (type === 'TD')                       pts = 6;
    else if (type === 'FG')                  pts = 3;
    else if (type === 'SFT' || type === 'SAF') pts = 2;
    else if (type === 'PAT' || type === 'XP')  pts = 1;
    else if (type === '2PC')                 pts = 2;

    if (pts > 0) score[tIdx] += pts;

    if (quarter !== null && quarter !== lastQuarter) {
      const label = quarter > 4 ? `OT${quarter - 4}` : `${ordinal(quarter)} quarter`;
      lines.push(`\n**${label}**`);
      lastQuarter = quarter;
    }

    const abbrev  = teamAbbrevByIdx[tIdx] || '?';
    const typeTag = type || '—';
    const runScore = `${score[0]}-${score[1]}`;
    const clock   = play.clock || play.time || '';
    const text    = String(play.text || '').trim();

    const clockStr = clock ? ` *${clock}*` : '';
    lines.push(`\`${abbrev}\` **${typeTag}** ${runScore}${clockStr} — ${text}`);
  }

  if (!lines.length) return null;

  // Discord embed field max is 1024 chars; trim if needed
  let out = lines.join('\n').trim();
  if (out.length > 1020) {
    out = out.slice(0, 1000).trimEnd() + '\n*…truncated*';
  }
  return out;
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
      (g.teams || []).every((t) => typeof t.pts === 'number') // only played games
    );

    if (!teamGames.length)
      return interaction.editReply(`No completed games found for **${getTeamName(team)}** this season.`);

    // Group by week
    const byWeek = new Map();
    for (const game of teamGames) {
      const week = inferWeekFromGameDay(game.day);
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
    const teamSide = (game.teams || []).find((t) => t.tid === team.tid);
    const oppSide  = (game.teams || []).find((t) => t.tid !== team.tid);
    if (!teamSide || !oppSide) return interaction.editReply('❌ Malformed game data.');

    const oppTeam  = teamMap.get(oppSide.tid);
    const teamPts  = teamSide.pts ?? '?';
    const oppPts   = oppSide.pts  ?? '?';
    const teamWon  = Number(teamPts) > Number(oppPts);
    // team[0] = home in Football GM
    const isHome   = game.teams?.[0]?.tid === team.tid;

    const { passers, rushers, receivers, fromGame }           = buildStatLists(teamSide, leagueData, season);
    const { passers: oPas, rushers: oRus, receivers: oRec }  = buildStatLists(oppSide,  leagueData, season);

    const mk = (arr, fmt, max = 3) => arr.slice(0, max).map(fmt).join('\n') || '*—*';

    const noteStr = fromGame ? '' : '\n*⚠️ Per-game stats unavailable — showing season totals*';

    // Home team is always game.teams[0] in FBGM; match that ordering
    // so the scoring summary's `t` indices align with teamAbbrevByIdx.
    const teamAtIdx0 = teamMap.get(game.teams?.[0]?.tid);
    const teamAtIdx1 = teamMap.get(game.teams?.[1]?.tid);
    const scoringSummaryText = buildScoringSummary(game, teamAtIdx0, teamAtIdx1);

    const embed = new EmbedBuilder()
      .setTitle(`🏈 Week ${requestedWeek} — ${getTeamName(team)} vs ${getTeamName(oppTeam) || '?'}`)
      .setColor(teamWon ? 0x2ecc71 : 0xe74c3c)
      .setDescription(
        `${isHome ? '🏠' : '✈️'} **${getTeamName(team)}** ${teamPts}  vs  ${oppPts} **${getTeamName(oppTeam) || '?'}** ${isHome ? '✈️' : '🏠'}\n` +
        `${getTeamName(team)} score: ${buildScoreLine(teamSide)}\n` +
        `${getTeamName(oppTeam) || '?'} score: ${buildScoreLine(oppSide)}` +
        noteStr
      );

    // Prepend scoring summary if available
    if (scoringSummaryText) {
      embed.addFields({ name: '📜 Scoring Summary', value: scoringSummaryText, inline: false });
    }

    embed.addFields(
      { name: `${getTeamName(team)} — Passing`,   value: mk(passers,   fmtPasser),   inline: false },
      { name: `${getTeamName(team)} — Rushing`,   value: mk(rushers,   fmtRusher),   inline: false },
      { name: `${getTeamName(team)} — Receiving`, value: mk(receivers, fmtReceiver), inline: false },
      { name: `${getTeamName(oppTeam) || '?'} — Passing`,   value: mk(oPas, fmtPasser),   inline: false },
      { name: `${getTeamName(oppTeam) || '?'} — Rushing`,   value: mk(oRus, fmtRusher),   inline: false },
      { name: `${getTeamName(oppTeam) || '?'} — Receiving`, value: mk(oRec, fmtReceiver), inline: false },
    );

    embed
      .setFooter({ text: `Week ${requestedWeek} • Available weeks: ${availWeeks.slice(0, 10).join(', ')}` })
      .setTimestamp();

    const logo = getTeamLogoUrl(team);
    if (logo) embed.setThumbnail(logo);

    return interaction.editReply({ embeds: [embed] });
  },
};