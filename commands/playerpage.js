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
  getTeamName,
  safeNumber,
  getTeamLogoUrl,
} = require('../utils/data');
const {
  matchesTeam,
} = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');

const INFO_SHEET_ID =
  process.env.NZCFL_INFO_SHEET_ID ||
  process.env.GOOGLE_SHEET_ID ||
  '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';

const cleanHeaderKey = (s) =>
  String(s || '').toLowerCase().trim().replace(/[.:?!]+$/, '').trim();

function findCol(colMap, exactKeys, containsKeys = []) {
  for (const k of exactKeys) if (colMap.has(k)) return colMap.get(k);
  for (const [h, i] of colMap) {
    if (containsKeys.some((k) => h.includes(k))) return i;
  }
  return -1;
}

// Parse the NZCFL Info recruiting tab the same way /recruitingclass does.
function toRecruitObjects(rows) {
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if ((rows[i] || []).some((c) => cleanHeaderKey(c) === 'name')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const header = rows[headerIdx];
  const dataRows = rows.slice(headerIdx + 1);
  const colMap = new Map();
  header.forEach((h, i) => colMap.set(cleanHeaderKey(h), i));

  const nameCol = findCol(colMap, ['name'], ['name']);
  const posCol = findCol(colMap, ['pos', 'position'], ['pos']);
  const commitCol = findCol(
    colMap,
    ['committed', 'commit', 'team', 'school', 'destination', 'pledge'],
    ['commit', 'pledge']
  );

  return dataRows
    .map((row) => {
      const name = nameCol >= 0 ? String(row[nameCol] || '').trim() : String(row[1] || '').trim();
      if (!name) return null;
      return {
        Name: name,
        Pos: posCol >= 0 ? String(row[posCol] || '').trim() : '',
        commit: commitCol >= 0 ? String(row[commitCol] || '').trim() : '',
      };
    })
    .filter((r) => r && r.Name);
}

// Case-insensitive name match. Tries full "first last" first, then last-name
// suffix match as a fallback.
function findRecruitCommit(recruits, player) {
  if (!recruits.length) return null;
  const first = String(player.firstName || '').toLowerCase().trim();
  const last = String(player.lastName || '').toLowerCase().trim();
  const full = `${first} ${last}`.trim();
  if (!full) return null;

  const exact = recruits.find((r) => r.Name.toLowerCase().trim() === full);
  if (exact) return exact;

  const loose = recruits.find((r) => {
    const n = r.Name.toLowerCase().trim();
    return n.endsWith(` ${last}`) && n.includes(first);
  });
  return loose || null;
}

// Given a commit string from the sheet (e.g. "Michigan State"), find the
// matching active team in the league and return its display name.
function resolveCommitDisplay(leagueData, commitString) {
  const raw = String(commitString || '').trim();
  if (!raw) return null;

  const matched = (leagueData.teams || []).find(
    (t) => !t.disabled && matchesTeam(raw, t)
  );
  if (matched) {
    return `${getTeamName(matched)} (${matched.abbrev})`;
  }
  return raw;
}

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
    const isDraftProspect = player.tid === -2;

    const currentSeason = getCurrentSeason(leagueData);
    const pos = getLatestPosition(player);
    const homeState = getHomeState(player);
    const ratingBlock = getRelevantRatings(player);
    const previousTeams = getPreviousTeams(player, teamMap);

    // For Draft Prospects, look up their commit in the NZCFL Info sheet. A
    // failed lookup just means "commit is unknown yet", not an error.
    let commitDisplay = null;
    if (isDraftProspect) {
      try {
        const season = Number(currentSeason);
        if (Number.isFinite(season)) {
          const sheetName = `${season} Recruiting`;
          const rows = await fetchSheetCsv(INFO_SHEET_ID, sheetName);
          const recruits = toRecruitObjects(rows);
          const found = findRecruitCommit(recruits, player);
          if (found && found.commit) {
            commitDisplay = resolveCommitDisplay(leagueData, found.commit);
          }
        }
      } catch (err) {
        console.error('playerpage recruit lookup error:', err);
      }
    }

    // Football GM uses tid === -2 for upcoming draft prospects / recruits
    // ("Draft Prospect" / DP), and tid === -1 for Free Agents.
    let teamDisplay;
    if (team) {
      teamDisplay = `${team.region} ${team.name} (${team.abbrev})`;
    } else if (isDraftProspect) {
      teamDisplay = 'Draft Prospect (DP)';
    } else if (player.tid === -1) {
      teamDisplay = 'Free Agent';
    } else {
      teamDisplay = 'Free Agent / N/A';
    }

    const logoUrl = team ? getTeamLogoUrl(team) : null;

    // DP players get a stripped-down profile: just commit status, position,
    // home state, previous teams (if any). No Jersey / Age / Grade / stats.
    let profileLines;
    if (isDraftProspect) {
      const committedValue = commitDisplay
        ? `**${commitDisplay}**`
        : '*N/A*';

      profileLines = [
        `Committed: ${committedValue}`,
        `Position: **${pos}**`,
        `Home State: **${homeState}**`,
      ];
    } else {
      const age = getCurrentAge(player, currentSeason);
      const grade = getGradeLabel(player, currentSeason);
      const jerseyNumber = getJerseyNumber(player);

      profileLines = [
        `Team: **${teamDisplay}**`,
        `Position: **${pos}**`,
        `Jersey: **#${jerseyNumber}**`,
        `Age: **${age}**`,
        `Grade: **${grade}**`,
        `Home State: **${homeState}**`,
      ];
    }

    if (previousTeams.length) {
      profileLines.push(`Previous Team(s): **${previousTeams.join(', ')}**`);
    }

    const fields = [
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
    ];

    // Only show stats for real players — a DP hasn't taken a college snap yet.
    if (!isDraftProspect) {
      const stats = getLatestPlayerStats(player, currentSeason, false);
      const statLines = buildRelevantStatLines(player, stats);
      fields.push({
        name: 'Stats',
        value: statLines.join('\n'),
        inline: false,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`🧾 ${`${player.firstName || ''} ${player.lastName || ''}`.trim()}`)
      .setColor(0x95a5a6)
      .addFields(...fields)
      .setFooter({ text: 'Short player page from latest Football GM export' })
      .setTimestamp();

    if (logoUrl) {
      embed.setThumbnail(logoUrl);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};