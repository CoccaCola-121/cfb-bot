// ============================================================
// commands/streaks.js
// Top 5 longest win/loss streaks per opponent for a coach or team.
//
// Usage:
//   /streaks [mode:team|coach] [subject:<name>] [filter_opponent:<name>]
//
//   mode = coach (default)  -> subject is a coach (defaults to your /iam coach)
//   mode = team             -> subject is a team  (defaults to your /iam team)
//
// Pulls all games from utils/h2h.js (CSV + JSON + overrides),
// groups streaks per opponent, then takes the top 5 of each result type.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const {
  loadAllGames,
  sameTeam,
  coachMatches,
  teamSubjectFn,
  teamOpponentFn,
  hydrateCoachPerspective,
  coachSubjectFn,
} = require('../utils/h2h');

const { opponentStreaks } = require('../utils/streakEngine');
const { coachAttribution } = require('../utils/coachTenures');
const { getUserCoachName, getUserTeam } = require('../utils/userMap');
const {
  getLatestLeagueData,
  getTeamName,
  getTeamLogoUrl,
  findTeamByName,
} = require('../utils/data');

// ─── Formatting ─────────────────────────────────────────────

function fmtRange(s) {
  const sy = s.start.year;
  const ey = s.end.year;
  if (sy === ey) return `(${sy})`;
  return `(${sy}–${ey})`;
}

function fmtStreakLine(s, idx) {
  const rank = idx + 1;
  return `\`${String(rank).padStart(2, ' ')}\`  **${s.length}** vs **${s.opponent}** ${fmtRange(s)}`;
}

function trimField(text, max = 1024) {
  if (!text) return '—';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

// Sort runs: longest first, then most recent end, then alphabetic opponent.
function sortRuns(runs) {
  return [...runs].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    if (b.end.year !== a.end.year) return b.end.year - a.end.year;
    if (b.end.week !== a.end.week) return b.end.week - a.end.week;
    return String(a.opponent).localeCompare(String(b.opponent));
  });
}

// ─── Mode handlers ──────────────────────────────────────────

async function teamMode(interaction, subjectInput, filterOpponent) {
  const leagueData = getLatestLeagueData();

  // Resolve subject team.
  let subjectTeam = null;
  let subjectName = null;

  if (subjectInput) {
    subjectTeam = leagueData ? findTeamByName(leagueData, subjectInput) : null;
    subjectName = subjectTeam ? getTeamName(subjectTeam) : subjectInput;
  } else {
    subjectTeam = leagueData
      ? await getUserTeam(leagueData, interaction.user.id)
      : null;
    if (!subjectTeam) {
      return interaction.editReply(
        "❌ I don't know which team you coach. Run `/iam` first or pass `subject:<team>`.",
      );
    }
    subjectName = getTeamName(subjectTeam);
  }

  const allGames = await loadAllGames();
  const subjectFn = teamSubjectFn(subjectName, leagueData);
  const opponentFn = teamOpponentFn(subjectName, leagueData);

  // Pre-filter to games this team played.
  let games = allGames.filter(
    (g) =>
      sameTeam(g.teamA, subjectName, leagueData) ||
      sameTeam(g.teamB, subjectName, leagueData),
  );

  if (filterOpponent) {
    games = games.filter((g) => {
      const opp = opponentFn(g);
      return opp && sameTeam(opp, filterOpponent, leagueData);
    });
  }

  if (!games.length) {
    return interaction.editReply(
      `No games found for **${subjectName}**${filterOpponent ? ` vs **${filterOpponent}**` : ''}.`,
    );
  }

  const runs = opponentStreaks(games, subjectFn, opponentFn);
  const wins = sortRuns(runs.filter((r) => r.type === 'win')).slice(0, 5);
  const losses = sortRuns(runs.filter((r) => r.type === 'loss')).slice(0, 5);

  const winText = wins.length
    ? wins.map(fmtStreakLine).join('\n')
    : '_None_';
  const lossText = losses.length
    ? losses.map(fmtStreakLine).join('\n')
    : '_None_';

  const filterSuffix = filterOpponent ? ` vs ${filterOpponent}` : '';
  const embed = new EmbedBuilder()
    .setTitle(`📈 Streaks — ${subjectName}${filterSuffix}`)
    .setColor(0x2980b9)
    .addFields(
      { name: '🏆 Top 5 Win Streaks',  value: trimField(winText)  },
      { name: '💀 Top 5 Loss Streaks', value: trimField(lossText) },
    )
    .setFooter({
      text: `${runs.length} streak${runs.length === 1 ? '' : 's'} across ${games.length} games`,
    })
    .setTimestamp();

  if (subjectTeam && getTeamLogoUrl) {
    const logo = getTeamLogoUrl(subjectTeam);
    if (logo) embed.setThumbnail(logo);
  }

  return interaction.editReply({ embeds: [embed] });
}

async function coachMode(interaction, subjectInput, filterOpponent) {
  const leagueData = getLatestLeagueData();
  const subjectCoach = subjectInput || getUserCoachName(interaction.user.id);

  if (!subjectCoach) {
    return interaction.editReply(
      "❌ I don't know which coach you are. Run `/iam` first or pass `subject:<coach>`.",
    );
  }

  const allGames = await loadAllGames();
  const hydrated = await hydrateCoachPerspective(allGames, subjectCoach);

  if (!hydrated.length) {
    return interaction.editReply(
      `No tracked games found for **${subjectCoach}** yet.`,
    );
  }

  // Resolve opponent coach + display label per game (async due to coachAttribution).
  const enriched = [];
  for (const g of hydrated) {
    const oppTeam = sameTeam(g.teamA, g.__subjectTeam, leagueData)
      ? g.teamB
      : g.teamA;

    let oppCoach = null;
    try {
      oppCoach = await coachAttribution(oppTeam, g.year, g.week);
    } catch {
      oppCoach = null;
    }

    // Display: coach if we have one, else team. This is the grouping key.
    const opponentLabel = oppCoach || oppTeam;

    // Apply filter_opponent: match against coach OR team.
    if (filterOpponent) {
      const matchesCoach = oppCoach && coachMatches(filterOpponent, oppCoach);
      const matchesTeamName = sameTeam(filterOpponent, oppTeam, leagueData);
      if (!matchesCoach && !matchesTeamName) continue;
    }

    enriched.push({
      ...g,
      __opponentTeam: oppTeam,
      __opponentCoach: oppCoach,
      __opponentLabel: opponentLabel,
    });
  }

  if (!enriched.length) {
    return interaction.editReply(
      `No games for **${subjectCoach}**${filterOpponent ? ` vs **${filterOpponent}**` : ''}.`,
    );
  }

  const subjectFn = coachSubjectFn();
  const opponentFn = (g) => g.__opponentLabel;
  const runs = opponentStreaks(enriched, subjectFn, opponentFn);

  const wins = sortRuns(runs.filter((r) => r.type === 'win')).slice(0, 5);
  const losses = sortRuns(runs.filter((r) => r.type === 'loss')).slice(0, 5);

  const winText = wins.length
    ? wins.map(fmtStreakLine).join('\n')
    : '_None_';
  const lossText = losses.length
    ? losses.map(fmtStreakLine).join('\n')
    : '_None_';

  const filterSuffix = filterOpponent ? ` vs ${filterOpponent}` : '';
  const embed = new EmbedBuilder()
    .setTitle(`📈 Streaks — ${subjectCoach}${filterSuffix}`)
    .setColor(0x9b59b6)
    .addFields(
      { name: '🏆 Top 5 Win Streaks',  value: trimField(winText)  },
      { name: '💀 Top 5 Loss Streaks', value: trimField(lossText) },
    )
    .setFooter({
      text: `${runs.length} streak${runs.length === 1 ? '' : 's'} across ${enriched.length} games`,
    })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// ─── Slash command ──────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('streaks')
    .setDescription('Top 5 longest win/loss streaks per opponent.')
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('Subject is a coach or a team (default: coach).')
        .setRequired(false)
        .addChoices(
          { name: 'coach', value: 'coach' },
          { name: 'team',  value: 'team'  },
        ),
    )
    .addStringOption((o) =>
      o
        .setName('subject')
        .setDescription('Override subject name (default: your linked coach/team).')
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName('filter_opponent')
        .setDescription('Only count streaks against this opponent (team or coach).')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const mode = interaction.options.getString('mode') || 'coach';
    const subject = interaction.options.getString('subject') || null;
    const filterOpponent =
      interaction.options.getString('filter_opponent') || null;

    try {
      if (mode === 'team') {
        return await teamMode(interaction, subject, filterOpponent);
      }
      return await coachMode(interaction, subject, filterOpponent);
    } catch (err) {
      console.error('[streaks] failed:', err);
      return interaction.editReply(
        `❌ Streaks lookup failed: ${err.message || err}`,
      );
    }
  },
};
