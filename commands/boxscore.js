// ============================================================
// commands/boxscore.js
// Clean single-game box score for one week
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

function findTeamByAbbrev(leagueData, abbrev) {
  return (leagueData.teams || []).find(
    (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === abbrev
  );
}

// In your exports, game.day already corresponds to the displayed week.
// Keeping this local avoids the off-by-one issue you already noted.
function weekFromDay(day) {
  if (typeof day !== 'number' || Number.isNaN(day)) return null;
  return day;
}

function getLatestPosition(player) {
  const ratings = player?.ratings;
  if (Array.isArray(ratings) && ratings.length) {
    return ratings[ratings.length - 1]?.pos || player.pos || '?';
  }
  return player.pos || '?';
}

function computeQbRating(statLine) {
  const att = safeNumber(statLine.pss);
  if (att <= 0) return null;

  const cmp = safeNumber(statLine.pssCmp);
  const yds = safeNumber(statLine.pssYds);
  const td = safeNumber(statLine.pssTD);
  const ints = safeNumber(statLine.pssInt);

  const clamp = (v) => Math.max(0, Math.min(2.375, v));

  const a = clamp(((cmp / att) - 0.3) * 5);
  const b = clamp(((yds / att) - 3) * 0.25);
  const c = clamp((td / att) * 20);
  const d = clamp(2.375 - ((ints / att) * 25));

  return ((a + b + c + d) / 6) * 100;
}

function buildRosterByPid(leagueData) {
  return new Map((leagueData.players || []).map((p) => [p.pid, p]));
}

function buildTeamGameLeaders(teamSide, leagueData, season, rosterByPid) {
  const tid = teamSide?.tid;
  const gamePlayers = Array.isArray(teamSide?.players) ? teamSide.players : [];

  // Preferred: actual per-game box score player stats
  if (gamePlayers.length > 0) {
    const withNames = gamePlayers.map((p) => {
      const rosterPlayer = rosterByPid.get(p.pid);
      const displayName = rosterPlayer
        ? `${rosterPlayer.firstName || ''} ${rosterPlayer.lastName || ''}`.trim()
        : `Player ${p.pid ?? '?'}`;

      return {
        ...p,
        displayName,
      };
    });

    const passers = withNames
      .filter((p) => safeNumber(p.pss) > 0)
      .sort((a, b) => safeNumber(b.pssYds) - safeNumber(a.pssYds));

    const rushers = withNames
      .filter((p) => safeNumber(p.rus) > 0)
      .sort((a, b) => safeNumber(b.rusYds) - safeNumber(a.rusYds));

    const receivers = withNames
      .filter((p) => safeNumber(p.rec) > 0)
      .sort((a, b) => safeNumber(b.recYds) - safeNumber(a.recYds));

    return {
      passer: passers[0] || null,
      rusher: rushers[0] || null,
      receiver: receivers[0] || null,
      fromGame: true,
    };
  }

  // Fallback: season totals if per-game player lines are unavailable
  const roster = (leagueData.players || []).filter((p) => p.tid === tid);

  const withSeasonStats = roster
    .map((p) => {
      const stats = (p.stats || []).find((s) => s.season === season && !s.playoffs);
      if (!stats) return null;

      return {
        displayName: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
        pos: getLatestPosition(p),

        pss: safeNumber(stats.pss),
        pssCmp: safeNumber(stats.pssCmp),
        pssYds: safeNumber(stats.pssYds),
        pssTD: safeNumber(stats.pssTD),
        pssInt: safeNumber(stats.pssInt),

        rus: safeNumber(stats.rus),
        rusYds: safeNumber(stats.rusYds),
        rusTD: safeNumber(stats.rusTD),

        rec: safeNumber(stats.rec),
        recYds: safeNumber(stats.recYds),
        recTD: safeNumber(stats.recTD),
      };
    })
    .filter(Boolean);

  const passers = withSeasonStats
    .filter((p) => p.pss > 0)
    .sort((a, b) => b.pssYds - a.pssYds);

  const rushers = withSeasonStats
    .filter((p) => p.rus > 0)
    .sort((a, b) => b.rusYds - a.rusYds);

  const receivers = withSeasonStats
    .filter((p) => p.rec > 0)
    .sort((a, b) => b.recYds - a.recYds);

  return {
    passer: passers[0] || null,
    rusher: rushers[0] || null,
    receiver: receivers[0] || null,
    fromGame: false,
  };
}

function fmtPasser(p) {
  if (!p) return '*—*';

  const cmp = p.pssCmp ?? '?';
  const att = p.pss ?? '?';
  const yds = safeNumber(p.pssYds);
  const td = safeNumber(p.pssTD);
  const ints = safeNumber(p.pssInt);
  const qbr = computeQbRating(p);

  const tdStr = td > 0 ? `, ${td} TD` : '';
  const intStr = ints > 0 ? `, ${ints} INT` : '';
  const qbrStr = qbr !== null ? ` | QBR **${qbr.toFixed(1)}**` : '';

  return `**${p.displayName || '?'}** — ${cmp}/${att}, **${yds}** yds${tdStr}${intStr}${qbrStr}`;
}

function fmtRusher(p) {
  if (!p) return '*—*';

  const attempts = safeNumber(p.rus);
  const yds = safeNumber(p.rusYds);
  const td = safeNumber(p.rusTD);
  const tdStr = td > 0 ? `, ${td} TD` : '';

  return `**${p.displayName || '?'}** — ${attempts} att, **${yds}** yds${tdStr}`;
}

function fmtReceiver(p) {
  if (!p) return '*—*';

  const rec = safeNumber(p.rec);
  const yds = safeNumber(p.recYds);
  const td = safeNumber(p.recTD);
  const tdStr = td > 0 ? `, ${td} TD` : '';

  return `**${p.displayName || '?'}** — ${rec} rec, **${yds}** yds${tdStr}`;
}

function fmtTeamMisc(side) {
  const tov = safeNumber(side?.tov);
  const pen = safeNumber(side?.pen);
  const penYds = safeNumber(side?.penYds);

  return `**Turnovers:** ${tov} • **Penalties:** ${pen}-${penYds}`;
}

function buildTeamSection(teamName, leaders, side) {
  return [
    `**Passing**\n${fmtPasser(leaders.passer)}`,
    `**Rushing**\n${fmtRusher(leaders.rusher)}`,
    `**Receiving**\n${fmtReceiver(leaders.receiver)}`,
    `**Misc**\n${fmtTeamMisc(side)}`,
  ].join('\n\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boxscore')
    .setDescription('Show box score for a team this season')
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation, e.g. MSU')
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('week')
        .setDescription('Week number (default: latest played week)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData?.games) {
      return interaction.editReply('❌ No game data loaded.');
    }

    const requestedAbbrev = interaction.options.getString('team').toUpperCase().trim();
    const requestedTeam = findTeamByAbbrev(leagueData, requestedAbbrev);

    if (!requestedTeam) {
      return interaction.editReply(`❌ No active team with abbreviation **${requestedAbbrev}**.`);
    }

    const teamMap = getTeamMap(leagueData);
    const season = getCurrentSeason(leagueData);
    const allGames = getGamesForCurrentSeason(leagueData);
    const rosterByPid = buildRosterByPid(leagueData);

    const completedGames = allGames.filter((g) => {
      const teams = g.teams || [];
      return (
        teams.some((t) => t.tid === requestedTeam.tid) &&
        teams.length === 2 &&
        teams.every((t) => typeof t.pts === 'number')
      );
    });

    if (!completedGames.length) {
      return interaction.editReply(
        `No completed games found for **${getTeamName(requestedTeam)}** this season.`
      );
    }

    const gamesByWeek = new Map();

    for (const game of completedGames) {
      const week = weekFromDay(game.day);
      if (week === null) continue;

      if (!gamesByWeek.has(week)) {
        gamesByWeek.set(week, []);
      }
      gamesByWeek.get(week).push(game);
    }

    const availableWeeks = [...gamesByWeek.keys()].sort((a, b) => b - a);
    const requestedWeek = interaction.options.getInteger('week') ?? availableWeeks[0];
    const gamesThisWeek = gamesByWeek.get(requestedWeek);

    if (!gamesThisWeek?.length) {
      return interaction.editReply(
        `No completed game found for **${getTeamName(requestedTeam)}** in Week ${requestedWeek}. ` +
        `Weeks with games: ${availableWeeks.slice(0, 12).join(', ')}`
      );
    }

    const game = gamesThisWeek[0];

    // FBGM convention in your current code:
    // game.teams[0] = home
    // game.teams[1] = away
    const homeSide = game.teams?.[0];
    const awaySide = game.teams?.[1];

    if (!homeSide || !awaySide) {
      return interaction.editReply('❌ Malformed game data.');
    }

    const homeTeam = teamMap.get(homeSide.tid);
    const awayTeam = teamMap.get(awaySide.tid);

    const homeName = getTeamName(homeTeam) || 'Home';
    const awayName = getTeamName(awayTeam) || 'Away';
    const homeAbbrev = String(homeTeam?.abbrev || 'HOME').toUpperCase();
    const awayAbbrev = String(awayTeam?.abbrev || 'AWAY').toUpperCase();

    const homePts = safeNumber(homeSide.pts);
    const awayPts = safeNumber(awaySide.pts);

    const requestedSide = requestedTeam.tid === homeSide.tid ? homeSide : awaySide;
    const opponentSide = requestedTeam.tid === homeSide.tid ? awaySide : homeSide;
    const requestedWon = safeNumber(requestedSide.pts) > safeNumber(opponentSide.pts);

    const homeLeaders = buildTeamGameLeaders(homeSide, leagueData, season, rosterByPid);
    const awayLeaders = buildTeamGameLeaders(awaySide, leagueData, season, rosterByPid);

    const fallbackUsed = !homeLeaders.fromGame || !awayLeaders.fromGame;

    const title = `W${requestedWeek} — ${awayAbbrev} ${awayPts} @ ${homePts} ${homeAbbrev}`;

    const descriptionLines = [
      `**${awayName}**`,
      buildTeamSection(awayName, awayLeaders, awaySide),
      '────────────────',
      `**${homeName}**`,
      buildTeamSection(homeName, homeLeaders, homeSide),
    ];

    if (fallbackUsed) {
      descriptionLines.push('', '*⚠️ Per-game player stats unavailable for at least one team. Showing season-total leaders where needed.*');
    }

    const embed = new EmbedBuilder()
      .setColor(requestedWon ? 0x2ecc71 : 0xe74c3c)
      .setTitle(title)
      .setDescription(descriptionLines.join('\n\n'))
      .setFooter({
        text: `Available weeks: ${availableWeeks.slice(0, 10).join(', ')}`,
      })
      .setTimestamp();

    // Discord cannot do two equal logos opposite each other in a normal embed.
    // Using one thumbnail avoids the ugly tiny-author-icon vs larger-thumbnail mismatch.
    const homeLogo = getTeamLogoUrl(homeTeam);
    if (homeLogo) {
      embed.setThumbnail(homeLogo);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};