// ============================================================
// commands/streaks.js
//
// /streaks [vs:<X>] [as:team|coach]
//
//   as:team  (default) → your linked team's active streaks per opponent
//   as:coach           → your coach career's streaks (across every team
//                         you've coached, attributed via Resume sheet
//                         + h2hOverrides)
//
//   vs:<opponent>      → (optional) restrict to a single opponent
//                         (matches team name or coach handle)
//   active:no          → show all-time longest streaks instead of active ones
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { findMatchingTeam } = require('../utils/sheets');

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
} = require('../utils/data');

function displayTeamAbbrev(value, leagueData) {
  const team = findMatchingTeam(leagueData, value);
  return team?.abbrev || String(value || '').trim();
}

// ─── Tiny formatters ────────────────────────────────────────

function fmtRange(s) {
  const sy = s.start.year;
  const ey = s.end.year;
  return sy === ey ? `${sy}` : `${sy}–${ey}`;
}

function fmtStreakLine(s, idx) {
  const rank = `**${idx + 1}.**`;
  return `${rank} **${s.length}** vs **${s.opponent}** · ${fmtRange(s)}`;
}

function trimField(text, max = 1024) {
  if (!text) return '_None_';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function sortRuns(runs) {
  return [...runs].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    if (b.end.year !== a.end.year) return b.end.year - a.end.year;
    if (b.end.week !== a.end.week) return b.end.week - a.end.week;
    return String(a.opponent).localeCompare(String(b.opponent));
  });
}

function isLaterStreak(a, b) {
  if ((a?.end?.year || 0) !== (b?.end?.year || 0)) {
    return (a?.end?.year || 0) > (b?.end?.year || 0);
  }
  if ((a?.end?.week || 0) !== (b?.end?.week || 0)) {
    return (a?.end?.week || 0) > (b?.end?.week || 0);
  }
  return false;
}

function latestRunsByOpponent(runs) {
  const latest = new Map();
  for (const run of runs || []) {
    const current = latest.get(run.opponent);
    if (!current || isLaterStreak(run, current)) {
      latest.set(run.opponent, run);
    }
  }
  return [...latest.values()];
}

// ─── Mode handlers ──────────────────────────────────────────

async function teamMode(interaction, vs, activeOnly) {
  const leagueData = getLatestLeagueData();
  const myTeam = leagueData
    ? await getUserTeam(leagueData, interaction.user.id)
    : null;

  if (!myTeam) {
    return interaction.editReply(
      "❌ I don't know which team you coach. Run `/iam` first.",
    );
  }

  const myName = getTeamName(myTeam);
  const allGames = await loadAllGames();
  const subjectFn = teamSubjectFn(myName, leagueData);
  const rawOpponentFn = teamOpponentFn(myName, leagueData);
  const opponentFn = (g) => displayTeamAbbrev(rawOpponentFn(g), leagueData);

  let games = allGames.filter(
    (g) =>
      sameTeam(g.teamA, myName, leagueData) ||
      sameTeam(g.teamB, myName, leagueData),
  );

  if (vs) {
    games = games.filter((g) => {
      const opp = opponentFn(g);
      return opp && sameTeam(opp, vs, leagueData);
    });
  }

  if (!games.length) {
    return interaction.editReply(
      `No games found for **${myName}**${vs ? ` vs **${displayTeamAbbrev(vs, leagueData)}**` : ''}.`,
    );
  }

  const allRuns = opponentStreaks(games, subjectFn, opponentFn);
  const runs = activeOnly ? latestRunsByOpponent(allRuns) : allRuns;
  const wins = sortRuns(runs.filter((r) => r.type === 'win')).slice(0, 5);
  const losses = sortRuns(runs.filter((r) => r.type === 'loss')).slice(0, 5);

  const winText  = wins.length   ? wins.map(fmtStreakLine).join('\n')   : null;
  const lossText = losses.length ? losses.map(fmtStreakLine).join('\n') : null;

  const filterLabel = vs ? displayTeamAbbrev(vs, leagueData) : null;
  const modeLabel = activeOnly ? 'Active Streaks' : 'Streaks';
  const winHeader = activeOnly ? '🟢 Active Win Streaks' : '🟢 Top 5 Win Streaks';
  const lossHeader = activeOnly ? '🔴 Active Loss Streaks' : '🔴 Top 5 Loss Streaks';
  const embed = new EmbedBuilder()
    .setTitle(`📈 ${myName} · ${modeLabel}${filterLabel ? ` vs ${filterLabel}` : ''}`)
    .setColor(0x2980b9)
    .addFields(
      { name: winHeader,  value: trimField(winText)  },
      { name: lossHeader, value: trimField(lossText) },
    )
    .setFooter({
      text: `${games.length} game${games.length === 1 ? '' : 's'} · ${runs.length} ${activeOnly ? 'active ' : ''}streak${runs.length === 1 ? '' : 's'} tracked`,
    })
    .setTimestamp();

  if (myTeam && getTeamLogoUrl) {
    const logo = getTeamLogoUrl(myTeam);
    if (logo) embed.setThumbnail(logo);
  }

  return interaction.editReply({ embeds: [embed] });
}

async function coachMode(interaction, vs, activeOnly) {
  const leagueData = getLatestLeagueData();
  const myCoach = getUserCoachName(interaction.user.id);

  if (!myCoach) {
    return interaction.editReply(
      "❌ I don't know which coach you are. Run `/iam` first.",
    );
  }

  const allGames = await loadAllGames();
  const hydrated = await hydrateCoachPerspective(allGames, myCoach);

  if (!hydrated.length) {
    return interaction.editReply(
      `No tracked games found for **${myCoach}** yet.`,
    );
  }

  // Tag opponent coach (if known) so streaks group across team changes.
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

    if (vs) {
      const matchesCoach = oppCoach && coachMatches(vs, oppCoach);
      const matchesTeamName = sameTeam(vs, oppTeam, leagueData);
      if (!matchesCoach && !matchesTeamName) continue;
    }

    enriched.push({
      ...g,
      __opponentTeam: oppTeam,
      __opponentCoach: oppCoach,
      __opponentLabel: oppCoach || displayTeamAbbrev(oppTeam, leagueData),
    });
  }

  if (!enriched.length) {
    return interaction.editReply(
      `No games for **${myCoach}**${vs ? ` vs **${opponentFnLabel(vs, leagueData, hydrated)}**` : ''}.`,
    );
  }

  const subjectFn = coachSubjectFn();
  const opponentFn = (g) => g.__opponentLabel;
  const allRuns = opponentStreaks(enriched, subjectFn, opponentFn);
  const runs = activeOnly ? latestRunsByOpponent(allRuns) : allRuns;

  const wins = sortRuns(runs.filter((r) => r.type === 'win')).slice(0, 5);
  const losses = sortRuns(runs.filter((r) => r.type === 'loss')).slice(0, 5);

  const winText  = wins.length   ? wins.map(fmtStreakLine).join('\n')   : null;
  const lossText = losses.length ? losses.map(fmtStreakLine).join('\n') : null;

  const filterSuffix = vs ? ` vs ${opponentFnLabel(vs, leagueData, enriched)}` : '';
  const titleLabel = activeOnly ? 'Career Active Streaks' : 'Career Streaks';
  const winHeader = activeOnly ? '🟢 Active Win Streaks' : '🟢 Top 5 Win Streaks';
  const lossHeader = activeOnly ? '🔴 Active Loss Streaks' : '🔴 Top 5 Loss Streaks';
  const embed = new EmbedBuilder()
    .setTitle(`📈 ${myCoach} · ${titleLabel}${filterSuffix}`)
    .setColor(0x9b59b6)
    .addFields(
      { name: winHeader,  value: trimField(winText)  },
      { name: lossHeader, value: trimField(lossText) },
    )
    .setFooter({
      text: `${enriched.length} game${enriched.length === 1 ? '' : 's'} · ${runs.length} ${activeOnly ? 'active ' : ''}streak${runs.length === 1 ? '' : 's'} tracked`,
    })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// ─── Slash command ──────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('streaks')
    .setDescription('Active streaks per opponent by default. Use active:no for all-time longest streaks.')
    .addStringOption((o) =>
      o
        .setName('vs')
        .setDescription('Restrict to a single opponent (team or coach).')
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName('as')
        .setDescription("Whose record? 'team' (default) = your linked team. 'coach' = your coach career.")
        .setRequired(false)
        .addChoices(
          { name: 'team',  value: 'team'  },
          { name: 'coach', value: 'coach' },
        ),
    )
    .addBooleanOption((o) =>
      o
        .setName('active')
        .setDescription('Defaults to yes. Set to no to show all-time longest streaks instead.')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const vs = interaction.options.getString('vs') || null;
    const as = interaction.options.getString('as') || 'team';
    const active = interaction.options.getBoolean('active');
    const activeOnly = active !== false;

    try {
      if (as === 'coach') {
        return await coachMode(interaction, vs, activeOnly);
      }
      return await teamMode(interaction, vs, activeOnly);
    } catch (err) {
      console.error('[streaks] failed:', err);
      return interaction.editReply(
        `❌ Streaks lookup failed: ${err.message || err}`,
      );
    }
  },
};

function opponentFnLabel(vs, leagueData, games) {
  const coachMatch = games.find((g) => g.__opponentCoach && coachMatches(vs, g.__opponentCoach));
  if (coachMatch?.__opponentCoach) return coachMatch.__opponentCoach;
  return displayTeamAbbrev(vs, leagueData);
}
