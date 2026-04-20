// ============================================================
// commands/boxscore.js
// Compact single-game box score
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getGamesForCurrentSeason,
  getTeamMap,
  getTeamName,
  safeNumber,
  getCurrentSeason,
} = require('../utils/data');

function findTeamByAbbrev(leagueData, abbrev) {
  return (leagueData.teams || []).find(
    (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === abbrev
  );
}

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
      allPlayers: withNames,
      fromGame: true,
    };
  }

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

        fum: safeNumber(stats.fum),
        fumbles: safeNumber(stats.fumbles),
        fmb: safeNumber(stats.fmb),
        fmbLost: safeNumber(stats.fmbLost),
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
    allPlayers: withSeasonStats,
    fromGame: false,
  };
}

function fmtPasser(p) {
  if (!p) return 'QB: *—*';

  const cmp = p.pssCmp ?? '?';
  const att = p.pss ?? '?';
  const yds = safeNumber(p.pssYds);
  const td = safeNumber(p.pssTD);
  const ints = safeNumber(p.pssInt);
  const qbr = computeQbRating(p);

  const tdStr = td > 0 ? `, ${td} TD` : '';
  const intStr = ints > 0 ? `, ${ints} INT` : '';
  const qbrStr = qbr !== null ? ` | QBR ${qbr.toFixed(1)}` : '';

  return `QB: **${p.displayName || '?'}** — ${cmp}/${att}, **${yds}** yds${tdStr}${intStr}${qbrStr}`;
}

function fmtRusher(p) {
  if (!p) return 'Rush: *—*';

  const attempts = safeNumber(p.rus);
  const yds = safeNumber(p.rusYds);
  const td = safeNumber(p.rusTD);
  const tdStr = td > 0 ? `, ${td} TD` : '';

  return `Rush: **${p.displayName || '?'}** — ${attempts} att, **${yds}** yds${tdStr}`;
}

function fmtReceiver(p) {
  if (!p) return 'Rec: *—*';

  const rec = safeNumber(p.rec);
  const yds = safeNumber(p.recYds);
  const td = safeNumber(p.recTD);
  const tdStr = td > 0 ? `, ${td} TD` : '';

  return `Rec: **${p.displayName || '?'}** — ${rec} rec, **${yds}** yds${tdStr}`;
}

function sumPlayerInts(players) {
  return (players || []).reduce((sum, p) => sum + safeNumber(p.pssInt), 0);
}

function getLostFumblesFromPlayers(players) {
  let total = 0;

  for (const p of players || []) {
    const candidates = [
      p.fmbLost,
      p.fumLost,
      p.fumblesLost,
      p.fmb,
      p.fum,
      p.fumbles,
    ];

    const found = candidates.find((v) => typeof v === 'number' && !Number.isNaN(v));
    if (typeof found === 'number') total += found;
  }

  return total;
}

function computeTeamTurnovers(side, leaders) {
  const sideTov = side?.tov;

  if (typeof sideTov === 'number' && !Number.isNaN(sideTov) && sideTov >= 0) {
    return sideTov;
  }

  const playerInts = sumPlayerInts(leaders?.allPlayers || []);
  const lostFumbles = getLostFumblesFromPlayers(leaders?.allPlayers || []);

  return playerInts + lostFumbles;
}

function computePenaltyString(side) {
  const pen = safeNumber(side?.pen);
  const penYds = safeNumber(side?.penYds);
  return `${pen}-${penYds}`;
}

function buildCompactTeamBlock(teamName, leaders, side) {
  const turnovers = computeTeamTurnovers(side, leaders);
  const penalties = computePenaltyString(side);

  return [
    `**${teamName}**`,
    fmtPasser(leaders.passer),
    fmtRusher(leaders.rusher),
    fmtReceiver(leaders.receiver),
    `Misc: TO **${turnovers}** • Pen **${penalties}**`,
  ].join('\n');
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

    // FBGM convention in your file:
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

    const homePts = safeNumber(homeSide.pts);
    const awayPts = safeNumber(awaySide.pts);

    const requestedSide = requestedTeam.tid === homeSide.tid ? homeSide : awaySide;
    const opponentSide = requestedTeam.tid === homeSide.tid ? awaySide : homeSide;
    const requestedWon = safeNumber(requestedSide.pts) > safeNumber(opponentSide.pts);

    const homeLeaders = buildTeamGameLeaders(homeSide, leagueData, season, rosterByPid);
    const awayLeaders = buildTeamGameLeaders(awaySide, leagueData, season, rosterByPid);

    const fallbackUsed = !homeLeaders.fromGame || !awayLeaders.fromGame;

    const embed = new EmbedBuilder()
      .setColor(requestedWon ? 0x2ecc71 : 0xe74c3c)
      .setTitle(`Week ${requestedWeek} • ${awayName} ${awayPts} @ ${homePts} ${homeName}`)
      .addFields(
        {
          name: '\u200B',
          value: buildCompactTeamBlock(awayName, awayLeaders, awaySide),
          inline: true,
        },
        {
          name: '\u200B',
          value: buildCompactTeamBlock(homeName, homeLeaders, homeSide),
          inline: true,
        }
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};