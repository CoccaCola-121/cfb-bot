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
} = require('../utils/data');
const {
  getScholarshipInfo,
} = require('../utils/recruiting');

const INFO_SHEET_ID =
  process.env.NZCFL_INFO_SHEET_ID ||
  process.env.GOOGLE_SHEET_ID ||
  '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';

const RECRUITING_RANKS_SHEET_ID =
  process.env.NZCFL_RECRUITING_RANKS_SHEET_ID ||
  '1VWzSOnixaQlJBQOw6zAyKdfo_XFhPuTFKO_5noKQEq4';

const RECRUITING_RANKS_SHEET_NAME =
  process.env.NZCFL_RECRUITING_RANKS_SHEET_NAME ||
  '247';

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  row.push(cell);
  rows.push(row);

  return rows.map((r) => r.map((v) => String(v || '').trim()));
}

async function fetchSheetRows(sheetId, sheetName) {
  const url =
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq` +
    `?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch sheet "${sheetName}" from ${sheetId} (${res.status})`);
  }

  const text = await res.text();
  return parseCsv(text);
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

function getTeamAliases(team) {
  const aliases = new Set();

  const abbrev = String(team.abbrev || '').trim();
  const region = String(team.region || '').trim();
  const name = String(team.name || '').trim();
  const full = [region, name].filter(Boolean).join(' ').trim();

  if (abbrev) aliases.add(abbrev);
  if (region) aliases.add(region);
  if (name) aliases.add(name);
  if (full) aliases.add(full);

  if (full === 'Central Florida') aliases.add('UCF');
  if (full === 'Southern Methodist') aliases.add('SMU');
  if (full === 'Brigham Young') aliases.add('BYU');
  if (full === 'Louisiana State') aliases.add('LSU');
  if (full === 'North Carolina State') aliases.add('NC State');
  if (full === 'Virginia Polytechnic Institute and State University') {
    aliases.add('Virginia Tech');
    aliases.add('VT');
  }
  if (full === 'Texas Christian') aliases.add('TCU');
  if (full === 'Ohio State') aliases.add('tOSU');

  return new Set([...aliases].map(normalize).filter(Boolean));
}

function committedToTeam(value, team) {
  const normalized = normalize(value);
  if (!normalized) return false;
  return getTeamAliases(team).has(normalized);
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toRecruitObjects(rows) {
  const headerRow = rows[3] || [];
  const dataRows = rows.slice(4);

  return dataRows
    .map((row) => {
      const obj = {
        recruitId: String(row[0] || '').trim(),
      };

      for (let i = 0; i < headerRow.length; i++) {
        const key = String(headerRow[i] || '').trim();
        if (!key) continue;
        obj[key] = String(row[i + 1] || '').trim();
      }

      return obj;
    })
    .filter((row) => row.Name);
}

function build247Data(rows) {
  const teamMap = new Map();
  const recruitMap = new Map();

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;

    const teamRank = safeNum(row[0]);
    const school = String(row[1] || '').trim();

    if (!teamRank || !school || normalize(school) === 'school') {
      continue;
    }

    const rankScore = Number(row[2]) || 0;
    const recruitCount = safeNum(row[3]);
    const recruitIds = row
      .slice(4)
      .map((v) => String(v || '').trim())
      .filter((v) => /^\d+$/.test(v));

    const normalizedSchool = normalize(school);

    teamMap.set(normalizedSchool, {
      school,
      teamRank,
      rankScore,
      recruitCount,
      recruitIds,
    });

    for (let i = 0; i < recruitIds.length; i++) {
      const recruitId = recruitIds[i];
      if (!recruitMap.has(recruitId)) {
        recruitMap.set(recruitId, {
          recruitRank: i + 1,
          school,
          teamRank,
          rankScore,
        });
      }
    }
  }

  return { teamMap, recruitMap };
}

function get247TeamInfo(team, team247Map) {
  for (const alias of getTeamAliases(team)) {
    if (team247Map.has(alias)) {
      return team247Map.get(alias);
    }
  }
  return null;
}

function buildRecruitingSummaryForTeam(allRows, team, team247Map, recruit247Map) {
  const recruits = allRows
    .filter((row) => committedToTeam(row['Committed?'], team))
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

  if (!recruits.length) {
    return null;
  }

  const class247 = get247TeamInfo(team, team247Map);
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
        .setDescription('Team abbreviation, e.g. MSU')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData || !leagueData.teams) {
      return interaction.editReply('❌ No league data loaded. Ask a mod to run `/loadweek`.');
    }

    const query = interaction.options.getString('team').toUpperCase().trim();
    const currentSeason = Number(getCurrentSeason(leagueData));

    const team = leagueData.teams.find(
      (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === query
    );

    if (!team) {
      return interaction.editReply(`❌ No active team found with abbreviation **${query}**.`);
    }

    const season = getLatestTeamSeason(team, currentSeason);
    const stats = getLatestTeamStats(team, currentSeason, false);

    if (!season || !stats) {
      return interaction.editReply(`❌ No current-season data found for **${query}**.`);
    }

    let scholarshipInfo = null;
    let recruitingInfo = null;

    try {
      scholarshipInfo = await getScholarshipInfo({
        schoolName: team.region,
        abbrev: team.abbrev,
      }).catch(() => null);
    } catch (err) {
      console.error('teamstats scholarship fetch error:', err);
    }

    try {
      const recruitingSheetName = `${currentSeason + 1} Recruiting`;

      const [recruitingRows, recruiting247Rows] = await Promise.all([
        fetchSheetRows(INFO_SHEET_ID, recruitingSheetName),
        fetchSheetRows(RECRUITING_RANKS_SHEET_ID, RECRUITING_RANKS_SHEET_NAME),
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

    const wins = Number(season.won ?? 0);
    const losses = Number(season.lost ?? 0);
    const ties = Number(season.tied ?? 0);

    const gp = safeNumber(stats.gp, wins + losses + ties);
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

    const recruitingBits = [
      `Open Scholarships: **${scholarshipInfo?.scholarshipsAvailable ?? '?'}**`,
      `Class Score: **${recruitingInfo?.classScore?.toFixed?.(3) ?? '?'}**`,
      `Commits: **${recruitingInfo?.recruitCount ?? 0}**`,
    ];

    if (recruitingInfo?.rank !== null && recruitingInfo?.rank !== undefined) {
      recruitingBits.push(`Class Rank: **${recruitingInfo.rank}**`);
    }

    if (recruitingInfo?.top100 !== null && recruitingInfo?.top100 !== undefined) {
      recruitingBits.push(`Top 100: **${recruitingInfo.top100}**`);
    }

    if (recruitingInfo?.bestRecruit?.name) {
      recruitingBits.push(
        `Best Recruit: **${recruitingInfo.bestRecruit.name} (${recruitingInfo.bestRecruit.recruitRank ? `#${recruitingInfo.bestRecruit.recruitRank}` : 'Unranked'})**`
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(`${getTeamName(team)} (${team.abbrev})`)
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
          value: recruitingBits.join('  •  '),
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