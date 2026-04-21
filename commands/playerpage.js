// ============================================================
//  commands/playerpage.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getTeamMap,
  getLatestPosition,
  getLatestPlayerStats,
  findPlayerByName,
  getCurrentSeason,
  safeNumber,
  getTeamLogoUrl,
} = require('../utils/data');

function getCurrentAge(player, currentSeason) {
  if (typeof player.age === 'number') return player.age;
  if (player.born && typeof player.born.year === 'number' && typeof currentSeason === 'number') {
    return currentSeason - player.born.year;
  }
  return '?';
}

function getLatestRatings(player) {
  if (Array.isArray(player.ratings) && player.ratings.length > 0) {
    return player.ratings[player.ratings.length - 1];
  }
  return null;
}

function hasRedshirtHistory(player) {
  return Array.isArray(player.injuries) &&
    player.injuries.some((inj) => String(inj?.type || '').toLowerCase() === 'redshirt');
}

function getGradeLabel(player, currentSeason) {
  const age = getCurrentAge(player, currentSeason);
  if (!Number.isFinite(Number(age))) return '?';

  const numericAge = Number(age);
  const redshirt = hasRedshirtHistory(player);

  if (numericAge <= 18) return 'Prospect';

  if (!redshirt) {
    if (numericAge === 19) return 'Freshman';
    if (numericAge === 20) return 'Sophomore';
    if (numericAge === 21) return 'Junior';
    if (numericAge === 22) return 'Senior';
    return 'Upperclassman';
  }

  if (numericAge === 19) return 'Freshman';
  if (numericAge === 20) return 'Redshirt Freshman';
  if (numericAge === 21) return 'Redshirt Sophomore';
  if (numericAge === 22) return 'Redshirt Junior';
  if (numericAge === 23) return 'Redshirt Senior';
  return 'Redshirt Upperclassman';
}

function computeQbRating(stats) {
  const att = safeNumber(stats.pss);
  const cmp = safeNumber(stats.pssCmp);
  const yds = safeNumber(stats.pssYds);
  const td = safeNumber(stats.pssTD);
  const ints = safeNumber(stats.pssInt);

  if (att <= 0) return null;

  let a = ((cmp / att) - 0.3) * 5;
  let b = ((yds / att) - 3) * 0.25;
  let c = (td / att) * 20;
  let d = 2.375 - ((ints / att) * 25);

  a = Math.max(0, Math.min(2.375, a));
  b = Math.max(0, Math.min(2.375, b));
  c = Math.max(0, Math.min(2.375, c));
  d = Math.max(0, Math.min(2.375, d));

  return ((a + b + c + d) / 6) * 100;
}

function formatRatingPair(label, value) {
  return `${label}: **${value ?? '?'}**`;
}

function getRelevantRatings(player) {
  const ratings = getLatestRatings(player);
  const pos = getLatestPosition(player);

  if (!ratings) {
    return {
      overall: 'OVR: **?**  •  POT: **?**',
      physical: 'Hgt: **?**  •  Str: **?**  •  End: **?**  •  Spd: **?**',
      skills: 'No ratings available.',
    };
  }

  const overall = [
    formatRatingPair('OVR', ratings.ovr),
    formatRatingPair('POT', ratings.pot),
  ].join('  •  ');

  const physical = [
    formatRatingPair('Hgt', ratings.hgt),
    formatRatingPair('Str', ratings.stre),
    formatRatingPair('End', ratings.endu),
    formatRatingPair('Spd', ratings.spd),
  ].join('  •  ');

  let skillBits = [];

  if (pos === 'QB') {
    skillBits = [
      formatRatingPair('ThV', ratings.thv),
      formatRatingPair('ThP', ratings.thp),
      formatRatingPair('ThA', ratings.tha),
      formatRatingPair('Elu', ratings.elu),
    ];
  } else if (['RB', 'WR', 'TE'].includes(pos)) {
    skillBits = [
      formatRatingPair('Elu', ratings.elu),
      formatRatingPair('RtR', ratings.rtr),
      formatRatingPair('Hnd', ratings.hnd),
      formatRatingPair('Bsc', ratings.bsc),
    ];
  } else if (['OL', 'LT', 'LG', 'C', 'RG', 'RT'].includes(pos)) {
    skillBits = [
      formatRatingPair('Pbk', ratings.pbk),
      formatRatingPair('Rbk', ratings.rbk),
    ];
  } else if (['DL', 'DE', 'DT'].includes(pos)) {
    skillBits = [
      formatRatingPair('PRs', ratings.prs),
      formatRatingPair('Rns', ratings.rns),
      formatRatingPair('Tck', ratings.tck),
    ];
  } else if (['LB', 'ILB', 'OLB'].includes(pos)) {
    skillBits = [
      formatRatingPair('Pcv', ratings.pcv),
      formatRatingPair('Tck', ratings.tck),
      formatRatingPair('Prs', ratings.prs),
      formatRatingPair('Rns', ratings.rns),
    ];
  } else if (['CB', 'S', 'FS', 'SS'].includes(pos)) {
    skillBits = [
      formatRatingPair('Pcv', ratings.pcv),
    ];
  } else if (pos === 'K') {
    skillBits = [
      formatRatingPair('Kpw', ratings.kpw),
      formatRatingPair('Kac', ratings.kac),
    ];
  } else if (pos === 'P') {
    skillBits = [
      formatRatingPair('Ppw', ratings.ppw),
      formatRatingPair('Pac', ratings.pac),
    ];
  } else {
    skillBits = [
      formatRatingPair('OVR', ratings.ovr),
      formatRatingPair('POT', ratings.pot),
    ];
  }

  return {
    overall,
    physical,
    skills: skillBits.join('  •  '),
  };
}

function buildRelevantStatLines(player, stats) {
  if (!stats) return ['No current-season stats.'];

  const pos = getLatestPosition(player);

  const passYds = safeNumber(stats.pssYds);
  const passTd = safeNumber(stats.pssTD);
  const passInt = safeNumber(stats.pssInt);
  const passAtt = safeNumber(stats.pss);
  const qbRating = computeQbRating(stats);

  const rushYds = safeNumber(stats.rusYds);
  const rushTd = safeNumber(stats.rusTD);
  const rushAtt = safeNumber(stats.rus);

  const recYds = safeNumber(stats.recYds);
  const recTd = safeNumber(stats.recTD);
  const rec = safeNumber(stats.rec);

  const tackles = safeNumber(stats.defTckSolo) + safeNumber(stats.defTckAst);
  const sacks = safeNumber(stats.defSk);
  const defInt = safeNumber(stats.defInt);

  const lines = [];

  const primaryPasser = passAtt >= 40 || pos === 'QB';
  const meaningfulRush = rushYds >= 75 || rushTd >= 2 || rushAtt >= 15;
  const meaningfulRec = recYds >= 100 || recTd >= 2 || rec >= 8;
  const meaningfulDefense = tackles >= 8 || sacks >= 2 || defInt >= 1;

  if (primaryPasser && (passYds > 0 || passTd > 0 || passInt > 0)) {
    let passLine = `Pass: **${passYds} yds, ${passTd} TD, ${passInt} INT**`;
    if (qbRating !== null) {
      passLine += `  •  QBR: **${Number(qbRating).toFixed(1)}**`;
    }
    lines.push(passLine);
  }

  if (meaningfulRush) {
    lines.push(`Rush: **${rushYds} yds, ${rushTd} TD**`);
  }

  if (meaningfulRec) {
    lines.push(`Rec: **${recYds} yds, ${recTd} TD**`);
  }

  if (meaningfulDefense) {
    lines.push(`Defense: **${tackles} tkl, ${sacks} sk, ${defInt} INT**`);
  }

  if (lines.length === 0) {
    if (passYds > 0 || passTd > 0) {
      let passLine = `Pass: **${passYds} yds, ${passTd} TD, ${passInt} INT**`;
      if (qbRating !== null && passAtt >= 15) {
        passLine += `  •  QBR: **${Number(qbRating).toFixed(1)}**`;
      }
      lines.push(passLine);
    } else if (rushYds > 0 || rushTd > 0) {
      lines.push(`Rush: **${rushYds} yds, ${rushTd} TD**`);
    } else if (recYds > 0 || recTd > 0) {
      lines.push(`Rec: **${recYds} yds, ${recTd} TD**`);
    } else if (tackles > 0 || sacks > 0 || defInt > 0) {
      lines.push(`Defense: **${tackles} tkl, ${sacks} sk, ${defInt} INT**`);
    } else {
      lines.push('No current-season stats.');
    }
  }

  return lines;
}

function getPreviousTeams(player, teamMap) {
  const currentTid = player.tid;
  const seen = new Set();
  const orderedTids = [];

  const addTid = (tid) => {
    if (typeof tid !== 'number') return;
    if (tid < 0) return;
    if (tid === currentTid) return;
    if (seen.has(tid)) return;
    seen.add(tid);
    orderedTids.push(tid);
  };

  for (const tid of player.statsTids || []) {
    addTid(tid);
  }

  for (const txn of player.transactions || []) {
    addTid(txn?.tid);
  }

  return orderedTids
    .map((tid) => teamMap.get(tid))
    .filter(Boolean)
    .map((team) => `${team.region} ${team.name}`.trim());
}

function getJerseyNumber(player) {
  if (typeof player.jerseyNumber === 'string' || typeof player.jerseyNumber === 'number') {
    return player.jerseyNumber;
  }

  const latestRatings = getLatestRatings(player);
  if (
    latestRatings &&
    (typeof latestRatings.jerseyNumber === 'string' || typeof latestRatings.jerseyNumber === 'number')
  ) {
    return latestRatings.jerseyNumber;
  }

  return '?';
}

function getHomeState(player) {
  if (player?.born && typeof player.born.loc === 'string' && player.born.loc.trim()) {
    return player.born.loc.trim();
  }

  if (typeof player.college === 'string' && player.college.trim()) {
    return player.college.trim();
  }

  return '?';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playerpage')
    .setDescription('Show a short player page')
    .addStringOption((opt) =>
      opt
        .setName('player')
        .setDescription('Player name')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const query = interaction.options.getString('player');
    const player = findPlayerByName(leagueData, query);

    if (!player) {
      return interaction.editReply(`❌ Could not find a player matching **${query}**.`);
    }

    const teamMap = getTeamMap(leagueData);
    const team = player.tid >= 0 ? teamMap.get(player.tid) : null;

    // Football GM uses tid === -2 for upcoming draft prospects / recruits
    // ("Draft Prospect" / DP), and tid === -1 for Free Agents.
    let teamDisplay;
    if (team) {
      teamDisplay = `${team.region} ${team.name} (${team.abbrev})`;
    } else if (player.tid === -2) {
      teamDisplay = 'Draft Prospect (DP)';
    } else if (player.tid === -1) {
      teamDisplay = 'Free Agent';
    } else {
      teamDisplay = 'Free Agent / N/A';
    }
    const currentSeason = getCurrentSeason(leagueData);
    const pos = getLatestPosition(player);
    const age = getCurrentAge(player, currentSeason);
    const grade = getGradeLabel(player, currentSeason);
    const jerseyNumber = getJerseyNumber(player);
    const homeState = getHomeState(player);
    const stats = getLatestPlayerStats(player, currentSeason, false);
    const ratingBlock = getRelevantRatings(player);
    const statLines = buildRelevantStatLines(player, stats);
    const previousTeams = getPreviousTeams(player, teamMap);
    const logoUrl = team ? getTeamLogoUrl(team) : null;

    const profileLines = [
      `Team: **${teamDisplay}**`,
      `Position: **${pos}**`,
      `Jersey: **#${jerseyNumber}**`,
      `Age: **${age}**`,
      `Grade: **${grade}**`,
      `Home State: **${homeState}**`,
    ];

    if (previousTeams.length) {
      profileLines.push(`Previous Team(s): **${previousTeams.join(', ')}**`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`🧾 ${`${player.firstName || ''} ${player.lastName || ''}`.trim()}`)
      .setColor(0x95a5a6)
      .addFields(
        {
          name: 'Profile',
          value: profileLines.join('\n'),
          inline: false,
        },
        {
          name: 'Overall',
          value: ratingBlock.overall,
          inline: false,
        },
        {
          name: 'Physical',
          value: ratingBlock.physical,
          inline: false,
        },
        {
          name: 'Relevant Ratings',
          value: ratingBlock.skills,
          inline: false,
        },
        {
          name: 'Stats',
          value: statLines.join('\n'),
          inline: false,
        }
      )
      .setFooter({ text: 'Short player page from latest Football GM export' })
      .setTimestamp();

    if (logoUrl) {
      embed.setThumbnail(logoUrl);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};