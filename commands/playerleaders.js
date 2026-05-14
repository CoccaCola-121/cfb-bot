// ============================================================
//  commands/playerleaders.js
//  /playerleaders [stat]
//  Shows top 10 players in a stat category from football-gm JSON
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getCurrentSeason,
  getTeamMap,
  getLatestPlayerStats,
  getGamesForCurrentSeason,
  getCurrentSeasonWeekMap,
  getGameWeek,
  safeNumber,
} = require('../utils/data');

const TOP_N = 10;

function ordinal(n) {
  const abs = Math.abs(Number(n));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${abs}th`;

  switch (abs % 10) {
    case 1: return `${abs}st`;
    case 2: return `${abs}nd`;
    case 3: return `${abs}rd`;
    default: return `${abs}th`;
  }
}

function addCompetitionRanks(items, tieKeyFn) {
  if (!Array.isArray(items) || items.length === 0) return [];

  let rank = 1;

  return items.map((item, index) => {
    if (index === 0) {
      return { ...item, rank };
    }

    const prev = items[index - 1];
    const sameAsPrev = tieKeyFn(item) === tieKeyFn(prev);

    if (!sameAsPrev) {
      rank = index + 1;
    }

    return { ...item, rank };
  });
}

function getVisibleLeadersWithTiePolicy(allRankedLeaders, limit) {
  if (!Array.isArray(allRankedLeaders) || allRankedLeaders.length === 0) {
    return { leaders: [], tieNote: null };
  }

  const groups = [];
  for (const leader of allRankedLeaders) {
    const last = groups[groups.length - 1];
    if (!last || last.value !== leader.value) {
      groups.push({
        rank: leader.rank,
        value: leader.value,
        players: [leader],
      });
    } else {
      last.players.push(leader);
    }
  }

  const visible = [];
  let tieNote = null;

  for (const group of groups) {
    const nextCount = visible.length + group.players.length;

    if (nextCount <= limit) {
      visible.push(...group.players);
      continue;
    }

    if (group.players.length > 1) {
      tieNote = `*${group.players.length} players tied for ${ordinal(group.rank)}*`;
    }

    break;
  }

  return {
    leaders: visible,
    tieNote,
  };
}

function getLatestPosition(player) {
  if (Array.isArray(player.ratings) && player.ratings.length > 0) {
    return player.ratings[player.ratings.length - 1]?.pos || player.pos || '?';
  }
  return player.pos || '?';
}

function getWeeksPlayed(leagueData) {
  const games = getGamesForCurrentSeason(leagueData);
  if (!games.length) return 1;

  const weekMap = getCurrentSeasonWeekMap(leagueData);
  let maxWeek = 1;
  for (const game of games) {
    const week = getGameWeek(game, weekMap);
    if (week !== null) maxWeek = Math.max(maxWeek, week);
  }

  return maxWeek;
}

function getScaledMinimums(weeksPlayed) {
  return {
    completion_pct: Math.max(40, weeksPlayed * 14),
    pass_yards_per_attempt: Math.max(40, weeksPlayed * 14),
    qb_rating: Math.max(40, weeksPlayed * 14),
    rushing_yards_per_attempt: Math.max(20, weeksPlayed * 8),
    yards_per_reception: Math.max(10, weeksPlayed * 3),
  };
}

function getAttemptsInfo(stats) {
  return {
    passAttempts: safeNumber(stats.pss),
    rushAttempts: safeNumber(stats.rus),
    receptions: safeNumber(stats.rec),
  };
}

function computeQbRating(stats) {
  const att = safeNumber(stats.pss);
  const cmp = safeNumber(stats.pssCmp);
  const yds = safeNumber(stats.pssYds);
  const td = safeNumber(stats.pssTD);
  const ints = safeNumber(stats.pssInt);

  if (att <= 0) return null;

  // NFL passer rating formula, 0–158.3
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

function getStatValue(stats, category) {
  if (!stats) return null;

  const att = getAttemptsInfo(stats);

  switch (category) {
    case 'passing_yards':
      return stats.pssYds ?? null;

    case 'passing_tds':
      return stats.pssTD ?? null;

    case 'interceptions_thrown':
      return stats.pssInt ?? null;

    case 'pass_yards_per_attempt':
      return att.passAttempts > 0 ? safeNumber(stats.pssYds) / att.passAttempts : null;

    case 'completion_pct':
      return att.passAttempts > 0 ? (safeNumber(stats.pssCmp) / att.passAttempts) * 100 : null;

    case 'qb_rating':
      return (
        stats.qbRat ??
        stats.qbRating ??
        stats.pssRating ??
        stats.passerRating ??
        computeQbRating(stats)
      );

    case 'rushing_yards':
      return stats.rusYds ?? null;

    case 'rushing_yards_per_attempt':
      return att.rushAttempts > 0 ? safeNumber(stats.rusYds) / att.rushAttempts : null;

    case 'rushing_tds':
      return stats.rusTD ?? null;

    case 'receiving_yards':
      return stats.recYds ?? null;

    case 'yards_per_reception':
      return att.receptions > 0 ? safeNumber(stats.recYds) / att.receptions : null;

    case 'receiving_tds':
      return stats.recTD ?? null;

    case 'yards_from_scrimmage':
      return safeNumber(stats.rusYds) + safeNumber(stats.recYds);

    case 'rush_rec_tds':
      return safeNumber(stats.rusTD) + safeNumber(stats.recTD);

    case 'total_tackles':
      return safeNumber(stats.defTckSolo) + safeNumber(stats.defTckAst);

    case 'sacks':
      return stats.defSk ?? null;

    case 'interceptions_def':
      return stats.defInt ?? null;

    case 'forced_fumbles':
      return stats.defFmbFrc ?? null;

    default:
      return null;
  }
}

function meetsMinimum(category, stats, minimums) {
  const info = getAttemptsInfo(stats);

  switch (category) {
    case 'completion_pct':
    case 'pass_yards_per_attempt':
    case 'qb_rating':
      return info.passAttempts >= minimums[category];

    case 'rushing_yards_per_attempt':
      return info.rushAttempts >= minimums[category];

    case 'yards_per_reception':
      return info.receptions >= minimums[category];

    default:
      return true;
  }
}

function getMinimumLabel(category, minimums) {
  switch (category) {
    case 'completion_pct':
    case 'pass_yards_per_attempt':
    case 'qb_rating':
      return `Min ${minimums[category]} pass attempts`;

    case 'rushing_yards_per_attempt':
      return `Min ${minimums[category]} carries`;

    case 'yards_per_reception':
      return `Min ${minimums[category]} receptions`;

    default:
      return null;
  }
}

function formatValue(category, value) {
  if (value === null || value === undefined) return '?';

  switch (category) {
    case 'completion_pct':
    case 'pass_yards_per_attempt':
    case 'rushing_yards_per_attempt':
    case 'yards_per_reception':
    case 'qb_rating':
      return Number(value).toFixed(1);

    default:
      return Number(value).toFixed(0);
  }
}

const STAT_MAP = {
  passing_yards: { label: 'Passing Yards', emoji: '🎯' },
  passing_tds: { label: 'Passing TDs', emoji: '🏈' },
  interceptions_thrown: { label: 'Interceptions Thrown', emoji: '🚫' },
  pass_yards_per_attempt: { label: 'Pass Yards Per Attempt', emoji: '📏' },
  completion_pct: { label: 'Completion Percentage', emoji: '🎯' },
  qb_rating: { label: 'Quarterback Rating', emoji: '📈' },

  rushing_yards: { label: 'Rushing Yards', emoji: '🏃' },
  rushing_yards_per_attempt: { label: 'Rushing Yards Per Attempt', emoji: '⚡' },
  rushing_tds: { label: 'Rushing TDs', emoji: '💨' },

  receiving_yards: { label: 'Receiving Yards', emoji: '🙌' },
  yards_per_reception: { label: 'Yards Per Reception', emoji: '📬' },
  receiving_tds: { label: 'Receiving TDs', emoji: '🔥' },

  yards_from_scrimmage: { label: 'Yards From Scrimmage', emoji: '📦' },
  rush_rec_tds: { label: 'Rushing + Receiving TDs', emoji: '⚡' },

  total_tackles: { label: 'Total Tackles', emoji: '💥' },
  sacks: { label: 'Sacks', emoji: '🔨' },
  interceptions_def: { label: 'Interceptions', emoji: '🔒' },
  forced_fumbles: { label: 'Forced Fumbles', emoji: '👊' },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playerleaders')
    .setDescription('Top 10 players in a stat category')
    .addStringOption((opt) =>
      opt
        .setName('stat')
        .setDescription('Stat category')
        .setRequired(true)
        .addChoices(
          { name: 'Passing Yards', value: 'passing_yards' },
          { name: 'Passing TDs', value: 'passing_tds' },
          { name: 'Interceptions Thrown', value: 'interceptions_thrown' },
          { name: 'Pass Yards Per Attempt', value: 'pass_yards_per_attempt' },
          { name: 'Completion Percentage', value: 'completion_pct' },
          { name: 'Quarterback Rating', value: 'qb_rating' },

          { name: 'Rushing Yards', value: 'rushing_yards' },
          { name: 'Rushing Yards Per Attempt', value: 'rushing_yards_per_attempt' },
          { name: 'Rushing TDs', value: 'rushing_tds' },

          { name: 'Receiving Yards', value: 'receiving_yards' },
          { name: 'Yards Per Reception', value: 'yards_per_reception' },
          { name: 'Receiving TDs', value: 'receiving_tds' },

          { name: 'Yards From Scrimmage', value: 'yards_from_scrimmage' },
          { name: 'Rushing + Receiving TDs', value: 'rush_rec_tds' },

          { name: 'Total Tackles', value: 'total_tackles' },
          { name: 'Sacks', value: 'sacks' },
          { name: 'Interceptions', value: 'interceptions_def' },
          { name: 'Forced Fumbles', value: 'forced_fumbles' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData) {
      return interaction.editReply('❌ No league data loaded. Ask a commissioner to run `/loadweek`.');
    }

    const category = interaction.options.getString('stat');
    const statInfo = STAT_MAP[category];

    if (!statInfo) {
      return interaction.editReply('❌ Unknown stat category.');
    }

    const currentSeason = getCurrentSeason(leagueData);
    const teamMap = getTeamMap(leagueData);
    const weeksPlayed = getWeeksPlayed(leagueData);
    const minimums = getScaledMinimums(weeksPlayed);
    const minimumLabel = getMinimumLabel(category, minimums);

    const allLeadersRaw = (leagueData.players || [])
      .map((player) => {
        const stats = getLatestPlayerStats(player, currentSeason, false);

        if (!stats) return null;
        if (player.tid === undefined || player.tid < 0) return null;

        const currentTeam = teamMap.get(player.tid);
        if (!currentTeam || currentTeam.disabled) return null;
        if (!meetsMinimum(category, stats, minimums)) return null;

        const value = getStatValue(stats, category);
        if (value === null || value === undefined || Number.isNaN(Number(value))) return null;

        return {
          name: `${player.firstName || ''} ${player.lastName || ''}`.trim(),
          team: currentTeam.abbrev || '?',
          pos: getLatestPosition(player),
          value: Number(value),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.value !== a.value) return b.value - a.value;
        return a.name.localeCompare(b.name);
      });

    const allRankedLeaders = addCompetitionRanks(allLeadersRaw, (item) => item.value);
    const { leaders, tieNote } = getVisibleLeadersWithTiePolicy(allRankedLeaders, TOP_N);

    if (leaders.length === 0 && !tieNote) {
      return interaction.editReply(`No player data found for **${statInfo.label}** in the loaded JSON.`);
    }

    const rows = leaders.map((p) =>
      `\`${String(p.rank).padStart(2)}.\` **${p.name}** (${p.pos}, ${p.team}) — **${formatValue(category, p.value)}**`
    );

    if (tieNote) {
      rows.push(tieNote);
    }

    const footerParts = ['Football GM export'];
    if (minimumLabel) {
      footerParts.unshift(minimumLabel);
    }

    const embed = new EmbedBuilder()
      .setTitle(`${statInfo.emoji} ${statInfo.label} Leaders`)
      .setColor(0xc8a951)
      .setDescription(rows.join('\n'))
      .setFooter({ text: footerParts.join(' • ') })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
