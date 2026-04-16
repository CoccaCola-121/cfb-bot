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
  getRecruitingInfo,
} = require('../utils/recruiting');

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

      const gp = safeNumber(stats.gp, safeNumber(season.won) + safeNumber(season.lost) + safeNumber(season.tied));
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
      return interaction.editReply('❌ No league data loaded. Ask a commissioner to run `/loadweek`.');
    }

    const query = interaction.options.getString('team').toUpperCase().trim();
    const currentSeason = getCurrentSeason(leagueData);

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

    const [scholarshipInfo, recruitingInfo] = await Promise.all([
      getScholarshipInfo({ schoolName: team.region, abbrev: team.abbrev }).catch(() => null),
      getRecruitingInfo({ schoolName: team.region, abbrev: team.abbrev }).catch(() => null),
    ]);

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
      `247 Score: **${recruitingInfo?.classScore?.toFixed?.(3) ?? '?'}**`,
    ];

    if (recruitingInfo?.rank !== null && recruitingInfo?.rank !== undefined) {
      recruitingBits.push(`Class Rank: **${recruitingInfo.rank}**`);
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
      .setFooter({ text: 'Stats from latest loaded Football GM export + linked recruiting sheets' })
      .setTimestamp();

    if (teamLogo) {
      embed.setThumbnail(teamLogo);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};