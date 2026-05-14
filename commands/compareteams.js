// ============================================================
//  commands/compareteams.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getCurrentSeason,
  getLatestTeamSeason,
  getLatestTeamStats,
  getLatestPlayerStats,
  getLatestPosition,
  getTeamName,
  safeNumber,
  formatRecord,
} = require('../utils/data');

function findTeamByAbbrev(leagueData, abbrev) {
  const target = String(abbrev || '').toUpperCase().trim();
  return (leagueData.teams || []).find(
    (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === target
  );
}

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
        passYds: safeNumber(stats.pssYds),
        passYdsAllowed: safeNumber(stats.oppPssYds),
        rushYds: safeNumber(stats.rusYds),
        rushYdsAllowed: safeNumber(stats.oppRusYds),
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
    passYds: toRankMap('passYds', false),
    passYdsAllowed: toRankMap('passYdsAllowed', true),
    rushYds: toRankMap('rushYds', false),
    rushYdsAllowed: toRankMap('rushYdsAllowed', true),
  };
}

function getTopPlayerForTeam(leagueData, teamTid, statType, currentSeason) {
  const players = (leagueData.players || [])
    .filter((player) => player.tid === teamTid)
    .map((player) => {
      const stats = getLatestPlayerStats(player, currentSeason, false);
      if (!stats) return null;

      let value = 0;
      let extra = '';

      if (statType === 'passer') {
        value = safeNumber(stats.pssYds);
        extra = `${safeNumber(stats.pssYds)} yds, ${safeNumber(stats.pssTD)} TD, ${safeNumber(stats.pssInt)} INT`;
      } else if (statType === 'rusher') {
        value = safeNumber(stats.rusYds);
        extra = `${safeNumber(stats.rusYds)} yds, ${safeNumber(stats.rusTD)} TD`;
      } else if (statType === 'receiver') {
        value = safeNumber(stats.recYds);
        extra = `${safeNumber(stats.recYds)} yds, ${safeNumber(stats.recTD)} TD`;
      } else {
        return null;
      }

      if (value <= 0) return null;

      return {
        name: `${player.firstName || ''} ${player.lastName || ''}`.trim(),
        pos: getLatestPosition(player),
        value,
        extra,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      return a.name.localeCompare(b.name);
    });

  return players[0] || null;
}

function buildTeamSummary(team, season, stats) {
  const wins = safeNumber(season?.won);
  const losses = safeNumber(season?.lost);
  const ties = safeNumber(season?.tied);
  const gp = safeNumber(stats?.gp, wins + losses + ties);

  return {
    tid: team.tid,
    name: getTeamName(team),
    abbrev: team.abbrev || '?',
    record: formatRecord(wins, losses, ties),
    ppg: gp > 0 ? safeNumber(stats?.pts) / gp : 0,
    papg: gp > 0 ? safeNumber(stats?.oppPts) / gp : 0,
    passYds: safeNumber(stats?.pssYds),
    passYdsAllowed: safeNumber(stats?.oppPssYds),
    rushYds: safeNumber(stats?.rusYds),
    rushYdsAllowed: safeNumber(stats?.oppRusYds),
  };
}

function fmt(value, decimals = 1) {
  return Number(value).toFixed(decimals);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compareteams')
    .setDescription('Compare two teams')
    .addStringOption((opt) =>
      opt
        .setName('team1')
        .setDescription('First team abbreviation, e.g. MSU')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('team2')
        .setDescription('Second team abbreviation, e.g. TTU')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData || !leagueData.teams) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const currentSeason = getCurrentSeason(leagueData);

    const team1Abbrev = interaction.options.getString('team1').toUpperCase().trim();
    const team2Abbrev = interaction.options.getString('team2').toUpperCase().trim();

    if (team1Abbrev === team2Abbrev) {
      return interaction.editReply('❌ Pick two different teams.');
    }

    const team1 = findTeamByAbbrev(leagueData, team1Abbrev);
    const team2 = findTeamByAbbrev(leagueData, team2Abbrev);

    if (!team1) {
      return interaction.editReply(`❌ No active team found with abbreviation **${team1Abbrev}**.`);
    }
    if (!team2) {
      return interaction.editReply(`❌ No active team found with abbreviation **${team2Abbrev}**.`);
    }

    const season1 = getLatestTeamSeason(team1, currentSeason);
    const season2 = getLatestTeamSeason(team2, currentSeason);
    const stats1 = getLatestTeamStats(team1, currentSeason, false);
    const stats2 = getLatestTeamStats(team2, currentSeason, false);

    if (!season1 || !stats1) {
      return interaction.editReply(`❌ No current-season data found for **${team1Abbrev}**.`);
    }
    if (!season2 || !stats2) {
      return interaction.editReply(`❌ No current-season data found for **${team2Abbrev}**.`);
    }

    const a = buildTeamSummary(team1, season1, stats1);
    const b = buildTeamSummary(team2, season2, stats2);

    const rankMaps = buildTeamRankMaps(leagueData, currentSeason);

    const aTopPasser = getTopPlayerForTeam(leagueData, team1.tid, 'passer', currentSeason);
    const aTopRusher = getTopPlayerForTeam(leagueData, team1.tid, 'rusher', currentSeason);
    const aTopReceiver = getTopPlayerForTeam(leagueData, team1.tid, 'receiver', currentSeason);

    const bTopPasser = getTopPlayerForTeam(leagueData, team2.tid, 'passer', currentSeason);
    const bTopRusher = getTopPlayerForTeam(leagueData, team2.tid, 'rusher', currentSeason);
    const bTopReceiver = getTopPlayerForTeam(leagueData, team2.tid, 'receiver', currentSeason);

    const leftLines = [
      `Record: **${a.record}**`,
      `PPG: **${fmt(a.ppg)}** (${ordinal(rankMaps.ppg.get(a.tid))})`,
      `PAPG: **${fmt(a.papg)}** (${ordinal(rankMaps.papg.get(a.tid))})`,
      `Pass Yds: **${a.passYds}** (${ordinal(rankMaps.passYds.get(a.tid))})`,
      `Pass Yds Allowed: **${a.passYdsAllowed}** (${ordinal(rankMaps.passYdsAllowed.get(a.tid))})`,
      `Rush Yds: **${a.rushYds}** (${ordinal(rankMaps.rushYds.get(a.tid))})`,
      `Rush Yds Allowed: **${a.rushYdsAllowed}** (${ordinal(rankMaps.rushYdsAllowed.get(a.tid))})`,
    ];

    const rightLines = [
      `Record: **${b.record}**`,
      `PAPG: **${fmt(b.papg)}** (${ordinal(rankMaps.papg.get(b.tid))})`,
      `PPG: **${fmt(b.ppg)}** (${ordinal(rankMaps.ppg.get(b.tid))})`,
      `Pass Yds Allowed: **${b.passYdsAllowed}** (${ordinal(rankMaps.passYdsAllowed.get(b.tid))})`,
      `Pass Yds: **${b.passYds}** (${ordinal(rankMaps.passYds.get(b.tid))})`,
      `Rush Yds Allowed: **${b.rushYdsAllowed}** (${ordinal(rankMaps.rushYdsAllowed.get(b.tid))})`,
      `Rush Yds: **${b.rushYds}** (${ordinal(rankMaps.rushYds.get(b.tid))})`,
    ];

    const playerLinesA = [
      `Top Passer: ${aTopPasser ? `**${aTopPasser.name}** (${aTopPasser.pos}) — ${aTopPasser.extra}` : 'None'}`,
      `Top Rusher: ${aTopRusher ? `**${aTopRusher.name}** (${aTopRusher.pos}) — ${aTopRusher.extra}` : 'None'}`,
      `Top Receiver: ${aTopReceiver ? `**${aTopReceiver.name}** (${aTopReceiver.pos}) — ${aTopReceiver.extra}` : 'None'}`,
    ];

    const playerLinesB = [
      `Top Passer: ${bTopPasser ? `**${bTopPasser.name}** (${bTopPasser.pos}) — ${bTopPasser.extra}` : 'None'}`,
      `Top Rusher: ${bTopRusher ? `**${bTopRusher.name}** (${bTopRusher.pos}) — ${bTopRusher.extra}` : 'None'}`,
      `Top Receiver: ${bTopReceiver ? `**${bTopReceiver.name}** (${bTopReceiver.pos}) — ${bTopReceiver.extra}` : 'None'}`,
    ];

    const embed = new EmbedBuilder()
      .setTitle(`⚖️ ${a.abbrev} vs ${b.abbrev}`)
      .setColor(0x34495e)
      .addFields(
        {
          name: `${a.name} (${a.abbrev})`,
          value: leftLines.join('\n'),
          inline: true,
        },
        {
          name: `${b.name} (${b.abbrev})`,
          value: rightLines.join('\n'),
          inline: true,
        },
        {
          name: `${a.abbrev} Playmakers`,
          value: playerLinesA.join('\n'),
          inline: false,
        },
        {
          name: `${b.abbrev} Playmakers`,
          value: playerLinesB.join('\n'),
          inline: false,
        }
      )
      .setFooter({ text: 'Football GM export' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
