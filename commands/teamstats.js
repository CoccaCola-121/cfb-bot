// ============================================================
//  commands/teamstats.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getCurrentSeason,
  getLatestTeamSeason,
  getLatestTeamStats,
  getTeamName,
  getConferenceName,
  getDivisionName,
  getTeamLogoUrl,
  formatRecord,
  safeNumber,
  getLiveTeamRecord,
} = require('../utils/data');
const {
  getScholarshipInfo,
} = require('../utils/recruiting');
const {
  matchesTeam: sheetsMatchesTeam,
  getTeamAliases: sheetsGetTeamAliases,
  normalize: sheetsNormalize,
} = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');
const { getUserTeam } = require('../utils/userMap');
const { REG_SEASON_WEEKS } = require('../utils/weekLabels');
const {
  fetchCurrentRankings,
  findRankForTeam,
} = require('../utils/currentRankings');

const INFO_SHEET_ID =
  process.env.NZCFL_INFO_SHEET_ID ||
  process.env.GOOGLE_SHEET_ID ||
  '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';

const RECRUITING_RANKS_SHEET_ID =
  process.env.NZCFL_RECRUITING_RANKS_SHEET_ID ||
  '1VWzSOnixaQlJBQOw6zAyKdfo_XFhPuTFKO_5noKQEq4';

const RECRUITING_RANKS_SHEET_NAME =
  process.env.NZCFL_RECRUITING_RANKS_SHEET_NAME ||
  'Recruiting Rankings';

const RECRUITING_RANKS_SHEET_GID =
  process.env.NZCFL_RECRUITING_RANKS_SHEET_GID || '';

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

function addCompetitionRanks(items, key, ascending = false) {
  const sorted = [...items].sort((a, b) => {
    if (ascending) {
      if (a[key] !== b[key]) return a[key] - b[key];
    } else {
      if (b[key] !== a[key]) return b[key] - a[key];
    }
    return a.tid - b.tid;
  });

  let rank = 1;
  return sorted.map((item, index) => {
    if (index > 0 && item[key] !== sorted[index - 1][key]) {
      rank = index + 1;
    }
    return { ...item, rank };
  });
}

function buildTeamRankMaps(leagueData, currentSeason) {
  const rows = (leagueData.teams || [])
    .filter((team) => !team.disabled)
    .map((team) => {
      const stats = getLatestTeamStats(team, currentSeason, false);
      const season = getLatestTeamSeason(team, currentSeason);
      if (!stats || !season) return null;

      const gp = safeNumber(
        stats.gp,
        safeNumber(season.won) + safeNumber(season.lost) + safeNumber(season.tied)
      );
      if (gp <= 0) return null;

      return {
        tid: team.tid,
        ppg: safeNumber(stats.pts) / gp,
        papg: safeNumber(stats.oppPts) / gp,
        pssYds: safeNumber(stats.pssYds),
        rusYds: safeNumber(stats.rusYds),
        sacks: safeNumber(stats.defSk),
        takeaways: safeNumber(stats.defInt) + safeNumber(stats.defFmbRec),
      };
    })
    .filter(Boolean);

  function toRankMap(key, ascending = false) {
    const ranked = addCompetitionRanks(rows, key, ascending);
    const map = new Map();
    for (const row of ranked) {
      map.set(row.tid, row.rank);
    }
    return map;
  }

  return {
    ppg: toRankMap('ppg', false),
    papg: toRankMap('papg', true),
    pssYds: toRankMap('pssYds', false),
    rusYds: toRankMap('rusYds', false),
    sacks: toRankMap('sacks', false),
    takeaways: toRankMap('takeaways', false),
  };
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const cleanHeaderKey = (s) =>
  String(s || '').toLowerCase().trim().replace(/[.:?!]+$/, '').trim();

function findCol(colMap, exactKeys, containsKeys = []) {
  for (const k of exactKeys) if (colMap.has(k)) return colMap.get(k);
  for (const [h, i] of colMap) {
    if (containsKeys.some((k) => h.includes(k))) return i;
  }
  return -1;
}

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
  const ovrCol = findCol(colMap, ['ovr', 'overall', 'rtg'], ['ovr', 'overall']);
  const potCol = findCol(colMap, ['pot', 'potential'], ['pot', 'potential']);
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
        recruitId: String(row[0] || '').trim(),
        Name: name,
        Pos: posCol >= 0 ? String(row[posCol] || '').trim() : '?',
        Ovr: ovrCol >= 0 ? String(row[ovrCol] || '').trim() : '0',
        Pot: potCol >= 0 ? String(row[potCol] || '').trim() : '0',
        commit: commitCol >= 0 ? String(row[commitCol] || '').trim() : '',
      };
    })
    .filter((r) => r && r.Name);
}

function build247Data(rows) {
  const teamMap = new Map();
  const recruitMap = new Map();

  const teams = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;

    const teamRank = safeNum(row[0]);
    const school = String(row[1] || '').trim();
    if (!teamRank || !school) continue;
    if (sheetsNormalize(school) === 'school' || sheetsNormalize(row[0]) === 'rank') continue;

    const rankScore = Number(row[2]) || 0;
    const recruitCount = safeNum(row[3]);
    const recruitIds = row
      .slice(4)
      .map((v) => String(v || '').trim())
      .filter((v) => /^\d+$/.test(v));

    teams.push({ school, teamRank, rankScore, recruitCount, recruitIds });
  }

  const zeros = teams.filter((t) => t.recruitCount === 0);
  const tieRank = zeros.length ? Math.min(...zeros.map((t) => t.teamRank)) : null;

  for (const t of teams) {
    const tied = t.recruitCount === 0 && tieRank !== null;
    const normalizedSchool = sheetsNormalize(t.school);

    teamMap.set(normalizedSchool, {
      school: t.school,
      teamRank: tied ? tieRank : t.teamRank,
      rankScore: t.rankScore,
      recruitCount: t.recruitCount,
      recruitIds: t.recruitIds,
      tied,
    });

    for (let i = 0; i < t.recruitIds.length; i++) {
      const recruitId = t.recruitIds[i];
      if (!recruitMap.has(recruitId)) {
        recruitMap.set(recruitId, {
          recruitRank: i + 1,
          school: t.school,
          teamRank: tied ? tieRank : t.teamRank,
          rankScore: t.rankScore,
        });
      }
    }
  }

  return { teamMap, recruitMap };
}

function get247TeamInfo(team, team247Map) {
  for (const alias of sheetsGetTeamAliases(team)) {
    if (team247Map.has(alias)) {
      return team247Map.get(alias);
    }
  }
  const candidates = [getTeamName(team), team.name, team.region, team.abbrev]
    .filter(Boolean)
    .map(sheetsNormalize);
  for (const n of candidates) {
    if (team247Map.has(n)) return team247Map.get(n);
  }
  return null;
}

async function fetchRanks247() {
  if (RECRUITING_RANKS_SHEET_GID) {
    try {
      const rows = await fetchSheetCsv(RECRUITING_RANKS_SHEET_ID, RECRUITING_RANKS_SHEET_GID, true);
      if (rows && rows.length > 1) return rows;
    } catch (_e) { /* fall through */ }
  }

  const tried = new Set();
  for (const tab of [RECRUITING_RANKS_SHEET_NAME, 'Recruiting Rankings', '247', 'Rankings']) {
    if (!tab || tried.has(tab)) continue;
    tried.add(tab);
    try {
      const rows = await fetchSheetCsv(RECRUITING_RANKS_SHEET_ID, tab);
      if (rows && rows.length > 1) return rows;
    } catch (_e) { /* try next */ }
  }
  return [];
}

function buildRecruitingSummaryForTeam(allRows, team, team247Map, recruit247Map) {
  const recruits = allRows
    .filter((row) => sheetsMatchesTeam(row.commit, team))
    .map((row) => {
      const recruit247 = recruit247Map.get(String(row.recruitId || '').trim()) || null;

      return {
        id: String(row.recruitId || '').trim(),
        name: row.Name,
        pos: row.Pos || '?',
        ovr: safeNum(row.Ovr),
        pot: safeNum(row.Pot),
        recruitRank: recruit247?.recruitRank ?? null,
      };
    })
    .sort((a, b) => {
      const aRank = a.recruitRank ?? Number.MAX_SAFE_INTEGER;
      const bRank = b.recruitRank ?? Number.MAX_SAFE_INTEGER;

      if (aRank !== bRank) return aRank - bRank;
      if (b.pot !== a.pot) return b.pot - a.pot;
      if (b.ovr !== a.ovr) return b.ovr - a.ovr;
      return a.name.localeCompare(b.name);
    });

  const class247 = get247TeamInfo(team, team247Map);

  if (!recruits.length) {
    if (!class247) return null;
    return {
      recruitCount: 0,
      classScore: class247.rankScore ?? null,
      avgPot: 0,
      avgOvr: 0,
      top100: 0,
      bestRecruit: null,
      rank: class247.teamRank ?? null,
    };
  }

  const avgPot = recruits.reduce((sum, r) => sum + r.pot, 0) / recruits.length;
  const avgOvr = recruits.reduce((sum, r) => sum + r.ovr, 0) / recruits.length;
  const top100 = recruits.filter((r) => r.recruitRank && r.recruitRank <= 100).length;
  const bestRecruit = recruits.find((r) => r.recruitRank) || recruits[0];

  return {
    recruitCount: recruits.length,
    classScore: class247?.rankScore ?? null,
    avgPot,
    avgOvr,
    top100,
    bestRecruit,
    rank: class247?.teamRank ?? null,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('teamstats')
    .setDescription('Show stats for a team by abbreviation')
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation, e.g. MSU (defaults to your linked team if you ran /iam)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData || !leagueData.teams) {
      return interaction.editReply('❌ No league data loaded. Ask a mod to run `/loadweek`.');
    }

    const teamArg = interaction.options.getString('team');
    const currentSeason = Number(getCurrentSeason(leagueData));

    let team = null;
    let query = null;

    if (teamArg) {
      query = teamArg.toUpperCase().trim();
      team = leagueData.teams.find(
        (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === query
      );
      if (!team) {
        return interaction.editReply(`❌ No active team found with abbreviation **${query}**.`);
      }
    } else {
      team = await getUserTeam(leagueData, interaction.user.id);
      if (!team) {
        return interaction.editReply(
          '❌ No team specified and no linked coach found. ' +
            'Pass a team (e.g. `team: MSU`) or run `/iam coach:<your name>` first.'
        );
      }
      query = team.abbrev;
    }

    const season = getLatestTeamSeason(team, currentSeason);
    const stats = getLatestTeamStats(team, currentSeason, false);

    if (!season || !stats) {
      return interaction.editReply(`❌ No current-season data found for **${query}**.`);
    }

    let scholarshipInfo = null;
    let recruitingInfo = null;
    let currentRank = null;

    try {
      scholarshipInfo = await getScholarshipInfo({
        schoolName: team.region,
        abbrev: team.abbrev,
      }).catch(() => null);
    } catch (err) {
      console.error('teamstats scholarship fetch error:', err);
    }

    // Current Top-25 rank (from the same sheet /rankings reads).
    // Soft-fails so a sheet outage never blocks the rest of the embed.
    try {
      const { entries } = await fetchCurrentRankings();
      currentRank = findRankForTeam(entries, team);
    } catch (err) {
      console.error('teamstats current-rankings fetch error:', err);
    }

    try {
      const recruitingSheetName = `${currentSeason} Recruiting`;

      const [recruitingRows, recruiting247Rows] = await Promise.all([
        fetchSheetCsv(INFO_SHEET_ID, recruitingSheetName),
        fetchRanks247(),
      ]);

      const recruitingObjects = toRecruitObjects(recruitingRows);
      const { teamMap: team247Map, recruitMap } = build247Data(recruiting247Rows);

      recruitingInfo = buildRecruitingSummaryForTeam(
        recruitingObjects,
        team,
        team247Map,
        recruitMap
      );
    } catch (err) {
      console.error('teamstats recruiting sheet fetch error:', err);
      recruitingInfo = null;
    }

    const rankMaps = buildTeamRankMaps(leagueData, currentSeason);
    const teamLogo = getTeamLogoUrl(team);

    let wins = Number(season.won ?? 0);
    let losses = Number(season.lost ?? 0);
    let ties = Number(season.tied ?? 0);

    if (Number(season.season) === currentSeason) {
      // Use the centralized live record helper which counts each played
      // game exactly once (regular + bowls + playoffs) so we don't
      // double-count games that FGM already includes in season.won/lost.
      const live = getLiveTeamRecord(leagueData, team, currentSeason);
      if (live) {
        wins = live.wins;
        losses = live.losses;
        ties = live.ties;
      }
    }

    const gp = safeNumber(stats.gp, Number(season.won ?? 0) + Number(season.lost ?? 0) + ties);
    const pts = safeNumber(stats.pts);
    const oppPts = safeNumber(stats.oppPts);
    const ppg = gp > 0 ? pts / gp : 0;
    const papg = gp > 0 ? oppPts / gp : 0;

    const pssYds = safeNumber(stats.pssYds);
    const rusYds = safeNumber(stats.rusYds);
    const sacks = safeNumber(stats.defSk);
    const takeaways = safeNumber(stats.defInt) + safeNumber(stats.defFmbRec);

    const streak =
      typeof season.streak === 'number' && season.streak !== 0
        ? `${season.streak > 0 ? 'W' : 'L'}${Math.abs(season.streak)}`
        : 'Even';

    const conferenceName = getConferenceName(leagueData, season.cid ?? team.cid);
    const divisionName = getDivisionName(leagueData, season.did ?? team.did);

    const offenseBits = [
      `PPG: **${ppg.toFixed(1)}** (${ordinal(rankMaps.ppg.get(team.tid))})`,
      `Pass Yds: **${pssYds}** (${ordinal(rankMaps.pssYds.get(team.tid))})`,
      `Rush Yds: **${rusYds}** (${ordinal(rankMaps.rusYds.get(team.tid))})`,
    ];

    const defenseBits = [
      `PAPG: **${papg.toFixed(1)}** (${ordinal(rankMaps.papg.get(team.tid))})`,
      `Sacks: **${sacks}** (${ordinal(rankMaps.sacks.get(team.tid))})`,
      `Takeaways: **${takeaways}** (${ordinal(rankMaps.takeaways.get(team.tid))})`,
    ];

    const recruitingLine1 = [
      `Open Scholarships: **${scholarshipInfo?.scholarshipsAvailable ?? '?'}**`,
      `Commits: **${recruitingInfo?.recruitCount ?? 0}**`,
    ].join('  •  ');

    const recruitingLine2Parts = [
      `Class Score: **${recruitingInfo?.classScore?.toFixed?.(3) ?? '?'}**`,
    ];
    if (recruitingInfo?.rank !== null && recruitingInfo?.rank !== undefined) {
      recruitingLine2Parts.push(`Class Rank: **${recruitingInfo.rank}**`);
    }
    const recruitingLine2 = recruitingLine2Parts.join('  •  ');

    const recruitingValue = `${recruitingLine1}\n${recruitingLine2}`;

    const rankPrefix = currentRank ? `#${currentRank} ` : '';

    const embed = new EmbedBuilder()
      .setTitle(`${rankPrefix}${getTeamName(team)} (${team.abbrev})`)
      .setColor(0x1a6b3c)
      .addFields(
        {
          name: '📊 Record',
          value:
            `Overall: **${formatRecord(wins, losses, ties)}**\n` +
            `Conference: **${formatRecord(season.wonConf ?? 0, season.lostConf ?? 0, season.tiedConf ?? 0)}**\n` +
            `Division: **${formatRecord(season.wonDiv ?? 0, season.lostDiv ?? 0, season.tiedDiv ?? 0)}**`,
          inline: false,
        },
        {
          name: '⚔️ Offense',
          value: offenseBits.join('  •  '),
          inline: false,
        },
        {
          name: '🛡️ Defense',
          value: defenseBits.join('  •  '),
          inline: false,
        },
        {
          name: '🧢 Recruiting',
          value: recruitingValue,
          inline: false,
        },
        {
          name: '📅 Context',
          value: [
            `Conference: **${conferenceName}**`,
            `Division: **${divisionName}**`,
            `Streak: **${streak}**`,
          ].join('  •  '),
          inline: false,
        }
      )
      .setFooter({
        text: 'Stats from latest loaded Football GM export + NZCFL Info recruiting sheet + 247 recruiting ranks',
      })
      .setTimestamp();

    if (teamLogo) {
      embed.setThumbnail(teamLogo);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};