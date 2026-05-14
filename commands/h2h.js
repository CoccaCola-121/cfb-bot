// ============================================================
// commands/h2h.js
//
// /h2h opponent:<X> [as:team|coach]
//
//   as:team  (default)  → my linked team   vs the opponent (team)
//   as:coach            → my coach career  vs the opponent
//                         • if opponent matches a coach   → coach-vs-coach
//                         • otherwise                     → coach-vs-team
//
// Data flows through utils/h2h.js (CSV + JSON + overrides).
// Streak/record math goes through utils/streakEngine.js.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { findMatchingTeam } = require('../utils/sheets');

const {
  loadAllGames,
  sameTeam,
  coachMatches,
  teamSubjectFn,
  hydrateCoachPerspective,
  coachSubjectFn,
} = require('../utils/h2h');
const { currentStreak, recordFor } = require('../utils/streakEngine');
const { coachAttribution } = require('../utils/coachTenures');
const { getUserCoachName, getUserTeam, loadCoachIndex } = require('../utils/userMap');
const {
  getLatestLeagueData,
  getTeamName,
  getTeamLogoUrl,
  findTeamByName,
} = require('../utils/data');

const TRACKED_SINCE_SEASON = 2025;

function displayTeamAbbrev(value, leagueData) {
  const team = findMatchingTeam(leagueData, value);
  return team?.abbrev || String(value || '').trim();
}

function displayTeamHeader(value, leagueData) {
  const team = findMatchingTeam(leagueData, value);
  return team ? getTeamName(team) : String(value || '').trim();
}

// ─── Tiny formatters ────────────────────────────────────────

function fmtPct(p) {
  if (!Number.isFinite(p) || p === 0) return '—';
  return (p * 100).toFixed(1) + '%';
}

function fmtRecord(r) {
  return `${r.wins}-${r.losses}`;
}

function fmtStreak(s) {
  return s ? `**${s.label}**` : '—';
}

function fmtWeek(g) {
  return g.weekLabel || `Wk ${g.week}`;
}

// Bowl / playoff / conference-title / national-title rows on the H2H sheet
// are tracked with a synthetic "1-0" score (only the winner is meaningful).
// Treat any 1-0 game as a placeholder so we can render it as "Won/Lost"
// instead of pretending the game ended 1 to 0.
function isPlaceholderScore(g) {
  return (
    (g.scoreA === 1 && g.scoreB === 0) ||
    (g.scoreA === 0 && g.scoreB === 1)
  );
}

function fmtGameLine(g, viewerSide, leagueData) {
  const isViewerA = sameTeam(g.teamA, viewerSide, leagueData);
  const opp = displayTeamAbbrev(isViewerA ? g.teamB : g.teamA, leagueData);

  let icon = '⚪';
  if (g.winner) {
    icon = sameTeam(g.winner, viewerSide, leagueData) ? '✅' : '❌';
  }

  // Placeholder 1-0 game → show winner only.
  if (isPlaceholderScore(g)) {
    let result = '—';
    if (g.winner) {
      result = sameTeam(g.winner, viewerSide, leagueData) ? 'Won' : 'Lost';
    }
    return `${icon} **${result}** vs ${opp} · *${g.year} ${fmtWeek(g)}*`;
  }

  const myScore = isViewerA ? g.scoreA : g.scoreB;
  const oppScore = isViewerA ? g.scoreB : g.scoreA;
  const ms = myScore == null ? '?' : myScore;
  const os = oppScore == null ? '?' : oppScore;
  return `${icon} **${ms}-${os}** vs ${opp} · *${g.year} ${fmtWeek(g)}*`;
}

function trimField(text, max = 1024) {
  if (!text) return '—';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function sourceCounts(games) {
  const c = { csv: 0, json: 0, override: 0 };
  for (const g of games) {
    if (g.source === 'csv') c.csv++;
    else if (g.source === 'json') c.json++;
    else if (String(g.source || '').startsWith('override')) c.override++;
  }
  return c;
}

function biggestWin(games, viewerSide, leagueData) {
  let best = null;
  for (const g of games) {
    if (g.scoreA == null || g.scoreB == null || !g.winner) continue;
    if (!sameTeam(g.winner, viewerSide, leagueData)) continue;
    if (isPlaceholderScore(g)) continue; // synthetic 1-0; no real margin
    const margin = Math.abs(g.scoreA - g.scoreB);
    if (!best || margin > best.margin) best = { game: g, margin };
  }
  return best;
}

function biggestLoss(games, viewerSide, leagueData) {
  let worst = null;
  for (const g of games) {
    if (g.scoreA == null || g.scoreB == null || !g.winner) continue;
    if (sameTeam(g.winner, viewerSide, leagueData)) continue;
    if (isPlaceholderScore(g)) continue; // synthetic 1-0; no real margin
    const margin = Math.abs(g.scoreA - g.scoreB);
    if (!worst || margin > worst.margin) worst = { game: g, margin };
  }
  return worst;
}

function compactGameRef(g) {
  const margin = Math.abs((g.scoreA ?? 0) - (g.scoreB ?? 0));
  return `${margin}-pt margin · ${g.year} ${fmtWeek(g)}`;
}

async function opponentLooksLikeCoach(opponent) {
  if (!opponent) return false;

  const index = await loadCoachIndex();
  for (const entry of index.values()) {
    if (entry?.coach && coachMatches(opponent, entry.coach)) {
      return true;
    }
  }

  return false;
}

// ─── Mode handlers ──────────────────────────────────────────

async function teamMode(interaction, opponent) {
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
  const oppTeam =
    (leagueData ? findTeamByName(leagueData, opponent) : null) ||
    findMatchingTeam(leagueData, opponent);
  const oppLabel = oppTeam ? oppTeam.abbrev : opponent;
  const oppHeader = oppTeam ? getTeamName(oppTeam) : opponent;

  const all = await loadAllGames();
  const games = all.filter(
    (g) =>
      (sameTeam(g.teamA, myName, leagueData) &&
        sameTeam(g.teamB, opponent, leagueData)) ||
      (sameTeam(g.teamB, myName, leagueData) &&
        sameTeam(g.teamA, opponent, leagueData)),
  );

  if (!games.length) {
    return interaction.editReply(
      `No meetings on record between **${myName}** and **${oppLabel}**.`,
    );
  }

  const subject = teamSubjectFn(myName, leagueData);
  const record = recordFor(games, subject);
  const streak = currentStreak(games, subject);
  const counts = sourceCounts(games);

  const recent = games
    .slice(-5)
    .reverse()
    .map((g) => fmtGameLine(g, myName, leagueData));

  const win  = biggestWin(games, myName, leagueData);
  const loss = biggestLoss(games, myName, leagueData);
  const notable = [
    win  ? `🏆 **Biggest win:** ${win.game.scoreA}-${win.game.scoreB} *(${compactGameRef(win.game)})*` : null,
    loss ? `💀 **Worst loss:** ${loss.game.scoreA}-${loss.game.scoreB} *(${compactGameRef(loss.game)})*` : null,
  ].filter(Boolean).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🏈 ${myName} vs ${oppHeader}`)
    .setColor(0x2980b9)
    .setDescription(
      `**${fmtRecord(record)}**  ·  ${fmtPct(record.pct)}  ·  Streak ${fmtStreak(streak)}\n*H2H tracking starts in ${TRACKED_SINCE_SEASON}.*`,
    )
    .addFields(
      {
        name: `Last ${Math.min(5, games.length)} meetings`,
        value: trimField(recent.join('\n')),
      },
      { name: 'Notable', value: trimField(notable || '—') },
    )
    .setFooter({
      text: 'NZCFL Tracker 2.0 + Football GM export + H2H overrides',
    })
    .setTimestamp();

  const logo = getTeamLogoUrl ? getTeamLogoUrl(myTeam) : null;
  if (logo) embed.setThumbnail(logo);

  return interaction.editReply({ embeds: [embed] });
}

async function coachMode(interaction, opponent) {
  const leagueData = getLatestLeagueData();
  const myCoach = getUserCoachName(interaction.user.id);

  if (!myCoach) {
    return interaction.editReply(
      "❌ I don't know which coach you are. Run `/iam` first.",
    );
  }

  const all = await loadAllGames();
  const hydrated = await hydrateCoachPerspective(all, myCoach);

  if (!hydrated.length) {
    return interaction.editReply(
      `No tracked games found for **${myCoach}** yet.`,
    );
  }

  // Decide if opponent is a coach (coach-vs-coach) or team (coach-vs-team).
  const matchedAsCoach = [];
  const matchedAsTeam = [];

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

    if (oppCoach && coachMatches(opponent, oppCoach)) {
      matchedAsCoach.push({
        ...g,
        __opponentCoach: oppCoach,
        __opponentTeam: oppTeam,
      });
      continue;
    }

    if (sameTeam(opponent, oppTeam, leagueData)) {
      matchedAsTeam.push({ ...g, __opponentTeam: oppTeam });
    }
  }

  const useCoach = matchedAsCoach.length > 0;
  const games = useCoach ? matchedAsCoach : matchedAsTeam;
  const opponentLabel =
    useCoach
      ? opponent
      : displayTeamAbbrev(
          (games[0]?.__opponentTeam || opponent),
          leagueData,
        );
  const opponentHeader =
    useCoach
      ? opponent
      : displayTeamHeader(
          (games[0]?.__opponentTeam || opponent),
          leagueData,
        );

  if (!games.length) {
    return interaction.editReply(
      `No meetings on record for **${myCoach}** vs **${opponentLabel}**.`,
    );
  }

  const subject = coachSubjectFn();
  const record = recordFor(games, subject);
  const streak = currentStreak(games, subject);
  const counts = sourceCounts(games);

  const recent = games
    .slice(-5)
    .reverse()
    .map((g) => fmtGameLine(g, g.__subjectTeam, leagueData));

  const lastSubjectTeam = games[games.length - 1].__subjectTeam;
  const win  = biggestWin(games, lastSubjectTeam, leagueData);
  const loss = biggestLoss(games, lastSubjectTeam, leagueData);
  const notable = [
    win  ? `🏆 **Biggest win:** ${win.game.scoreA}-${win.game.scoreB} *(${compactGameRef(win.game)})*` : null,
    loss ? `💀 **Worst loss:** ${loss.game.scoreA}-${loss.game.scoreB} *(${compactGameRef(loss.game)})*` : null,
  ].filter(Boolean).join('\n');

  const titleSuffix = useCoach ? '(coach vs coach)' : '(coach vs team)';
  const embed = new EmbedBuilder()
    .setTitle(`🏈 ${myCoach} vs ${opponentHeader}  ${titleSuffix}`)
    .setColor(useCoach ? 0x9b59b6 : 0x2980b9)
    .setDescription(
      `**${fmtRecord(record)}**  ·  ${fmtPct(record.pct)}  ·  Streak ${fmtStreak(streak)}\n*H2H tracking starts in ${TRACKED_SINCE_SEASON}.*`,
    )
    .addFields(
      {
        name: `Last ${Math.min(5, games.length)} meetings`,
        value: trimField(recent.join('\n')),
      },
      { name: 'Notable', value: trimField(notable || '—') },
    )
    .setFooter({
      text: 'NZCFL Tracker 2.0 + Football GM export + H2H overrides',
    })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// ─── Slash command ──────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('h2h')
    .setDescription('Head-to-head record vs a team or coach.')
    .addStringOption((o) =>
      o
        .setName('opponent')
        .setDescription('Team or coach name to compare against.')
        .setRequired(true),
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
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const opponent = interaction.options.getString('opponent');
    const explicitAs = interaction.options.getString('as');
    const as = explicitAs || (await opponentLooksLikeCoach(opponent) ? 'coach' : 'team');

    try {
      if (as === 'coach') {
        return await coachMode(interaction, opponent);
      }
      return await teamMode(interaction, opponent);
    } catch (err) {
      console.error('[h2h] failed:', err);
      return interaction.editReply(
        `❌ H2H lookup failed: ${err.message || err}`,
      );
    }
  },
};
