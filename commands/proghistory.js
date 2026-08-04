const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  findPlayerByName,
  findTeamByName,
  getCurrentSeason,
  getLatestPosition,
  getTeamByTid,
  getTeamColor,
  getTeamLogoUrl,
  getTeamName,
  getLatestLeagueData,
} = require('../utils/data');

const RATING_LABELS = {
  ovr: 'OVR',
  pot: 'POT',
  hgt: 'Hgt',
  stre: 'Str',
  endu: 'End',
  spd: 'Spd',
  thv: 'ThV',
  thp: 'ThP',
  tha: 'ThA',
  elu: 'Elu',
  rtr: 'RtR',
  hnd: 'Hnd',
  bsc: 'Bsc',
  pbk: 'Pbk',
  rbk: 'Rbk',
  prs: 'Prs',
  rns: 'Rns',
  tck: 'Tck',
  pcv: 'Pcv',
  kpw: 'Kpw',
  kac: 'Kac',
  ppw: 'Ppw',
  pac: 'Pac',
};

function relevantRatingKeys(pos) {
  const p = String(pos || '').toUpperCase();
  if (p === 'QB') return ['thv', 'thp', 'tha', 'elu'];
  if (['RB', 'WR'].includes(p)) return ['elu', 'rtr', 'hnd', 'bsc'];
  if (p === 'TE') return ['rtr', 'hnd', 'bsc', 'pbk', 'rbk'];
  if (['OL', 'LT', 'LG', 'C', 'RG', 'RT'].includes(p)) return ['pbk', 'rbk'];
  if (['DL', 'DE', 'DT', 'NT'].includes(p)) return ['prs', 'rns', 'tck'];
  if (['LB', 'ILB', 'OLB', 'MLB'].includes(p)) return ['pcv', 'tck', 'prs', 'rns'];
  if (['CB', 'S', 'FS', 'SS'].includes(p)) return ['pcv'];
  if (p === 'K') return ['kpw', 'kac'];
  if (p === 'P') return ['ppw', 'pac'];
  return ['spd', 'endu', 'stre'];
}

function ratingValue(rating, key) {
  const value = Number(rating?.[key]);
  return Number.isFinite(value) ? value : null;
}

function getRatingSeason(rating, index, currentSeason, total) {
  const season = Number(rating?.season);
  if (Number.isFinite(season)) return season;

  const numericCurrentSeason = Number(currentSeason);
  if (currentSeason !== null && currentSeason !== undefined && Number.isFinite(numericCurrentSeason)) {
    return numericCurrentSeason - total + 1 + index;
  }

  return null;
}

function signDelta(delta) {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function formatTopMovers(prev, curr, keys, limit = 3) {
  return keys
    .map((key) => {
      const before = ratingValue(prev, key);
      const after = ratingValue(curr, key);
      if (before === null || after === null) return null;
      const delta = after - before;
      if (delta === 0) return null;
      return { key, before, after, delta };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (Math.abs(b.delta) !== Math.abs(a.delta)) return Math.abs(b.delta) - Math.abs(a.delta);
      return b.delta - a.delta;
    })
    .slice(0, limit)
    .map((entry) => {
      const label = RATING_LABELS[entry.key] || entry.key.toUpperCase();
      return `${label} ${signDelta(entry.delta)} (${entry.before}->${entry.after})`;
    })
    .join(', ');
}

function buildProgressionRows(player, currentSeason) {
  const ratings = Array.isArray(player.ratings) ? player.ratings.filter(Boolean) : [];
  const keys = relevantRatingKeys(getLatestPosition(player));

  return ratings.map((rating, index) => {
    const season = getRatingSeason(rating, index, currentSeason, ratings.length);
    const prev = index > 0 ? ratings[index - 1] : null;
    const ovr = ratingValue(rating, 'ovr');
    const pot = ratingValue(rating, 'pot');
    const prevOvr = prev ? ratingValue(prev, 'ovr') : null;
    const prevPot = prev ? ratingValue(prev, 'pot') : null;
    const deltas = [];
    if (prevOvr !== null && ovr !== null) deltas.push(`OVR ${signDelta(ovr - prevOvr)}`);
    if (prevPot !== null && pot !== null) deltas.push(`POT ${signDelta(pot - prevPot)}`);
    const deltaText = deltas.length ? ` (${deltas.join(', ')})` : '';
    const movers = prev ? formatTopMovers(prev, rating, keys) : '';

    return [
      `**${season ?? '?'}**`,
      `${rating.pos || player.pos || '?'} ${ovr ?? '?'}/${pot ?? '?'}${deltaText}`,
      movers || (prev ? 'No relevant rating movement' : 'Baseline'),
    ];
  });
}

function scorePlayerNameMatch(player, query, currentSeason) {
  const fullName = `${player.firstName || ''} ${player.lastName || ''}`.trim();
  const q = String(query || '').toLowerCase().trim();
  const fullLower = fullName.toLowerCase();

  let score = 0;
  if (fullLower === q) score += 100;
  if (fullLower.startsWith(q)) score += 40;
  if (fullLower.includes(q)) score += 20;
  if ((player.lastName || '').toLowerCase() === q) score += 15;
  if (player.stats?.some((stat) => Number(stat?.season) === Number(currentSeason))) score += 10;
  if (player.tid >= 0) score += 5;
  if (player.tid === -2) score += 3;

  return { score, fullName };
}

function findPlayerByNameForTeam(leagueData, query, teamQuery) {
  const team = findTeamByName(leagueData, teamQuery);
  if (!team) {
    return { player: null, team: null, teamFound: false };
  }

  const currentSeason = getCurrentSeason(leagueData);
  const candidates = (leagueData.players || [])
    .filter((player) => player.tid === team.tid)
    .map((player) => {
      const { score, fullName } = scorePlayerNameMatch(player, query, currentSeason);
      return { player, score, fullName };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.fullName.localeCompare(b.fullName);
    });

  return { player: candidates[0]?.player || null, team, teamFound: true };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('proghistory')
    .setDescription('Show a player rating progression history')
    .addStringOption((opt) =>
      opt
        .setName('player')
        .setDescription('Player name')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Optional team filter for duplicate names')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const query = interaction.options.getString('player', true);
    const teamQuery = interaction.options.getString('team');
    let player;

    if (teamQuery) {
      const scoped = findPlayerByNameForTeam(leagueData, query, teamQuery);
      if (!scoped.teamFound) {
        return interaction.editReply(`❌ Could not find a team matching **${teamQuery}**.`);
      }
      player = scoped.player;
    } else {
      player = findPlayerByName(leagueData, query);
    }

    if (!player) {
      const scopedText = teamQuery ? ` on team **${teamQuery}**` : '';
      return interaction.editReply(`❌ Could not find a player matching **${query}**${scopedText}.`);
    }

    const ratings = Array.isArray(player.ratings) ? player.ratings.filter(Boolean) : [];
    if (!ratings.length) {
      return interaction.editReply(`❌ No rating history found for **${query}**.`);
    }

    const currentSeason = getCurrentSeason(leagueData);
    const team = player.tid >= 0 ? getTeamByTid(leagueData, player.tid) : null;
    const fullName = `${player.firstName || ''} ${player.lastName || ''}`.trim();
    const rows = buildProgressionRows(player, currentSeason);
    const lines = rows.map(([season, overall, movers]) => `${season}: ${overall}\n${movers}`);

    const embed = new EmbedBuilder()
      .setTitle(`📈 ${fullName} Progression`)
      .setColor(getTeamColor(team, 0x2b4b8c))
      .setDescription(lines.join('\n\n').slice(0, 4000))
      .setFooter({
        text: team
          ? `${getTeamName(team)} (${team.abbrev}) • Top movers use current-position relevant ratings`
          : 'Top movers use current-position relevant ratings',
      })
      .setTimestamp();

    const logo = team ? getTeamLogoUrl(team) : null;
    if (logo) embed.setThumbnail(logo);

    return interaction.editReply({ embeds: [embed] });
  },
};
