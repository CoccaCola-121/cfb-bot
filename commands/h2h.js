// ============================================================
// commands/h2h.js
// Head-to-head between teams or coaches.
//
// Usage:
//   /h2h target:<team or coach> [scope:team|coach]
//
//   scope = team  (default)  -> my linked team vs target team
//   scope = coach            -> my linked coach vs target
//                                  • if target matches a coach handle,
//                                    coach-vs-coach
//                                  • otherwise coach-vs-team
//
// All data flow goes through utils/h2h.js (CSV + league JSON + overrides).
// All record/streak math goes through utils/streakEngine.js.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

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
const { getUserCoachName, getUserTeam } = require('../utils/userMap');
const {
  getLatestLeagueData,
  getTeamName,
  getTeamLogoUrl,
  findTeamByName,
} = require('../utils/data');

// ─── Formatting ─────────────────────────────────────────────

function fmtPct(p) {
  if (!Number.isFinite(p)) return '0.0%';
  return (p * 100).toFixed(1) + '%';
}

function fmtRecord(r) {
  return `${r.wins}-${r.losses}`;
}

function fmtStreak(s) {
  return s ? s.label : '—';
}

function fmtGameLine(g, viewerSide, leagueData) {
  const viewerIsA = sameTeam(g.teamA, viewerSide, leagueData);
  const myScore = viewerIsA ? g.scoreA : g.scoreB;
  const oppScore = viewerIsA ? g.scoreB : g.scoreA;
  const opp = viewerIsA ? g.teamB : g.teamA;

  let result = '–';
  if (g.winner) {
    result = sameTeam(g.winner, viewerSide, leagueData) ? 'W' : 'L';
  }

  const week = g.weekLabel || `Wk ${g.week}`;
  const ms = myScore == null ? '?' : myScore;
  const os = oppScore == null ? '?' : oppScore;
  return `**${result}** ${ms}-${os} vs ${opp} *(${g.year} ${week})*`;
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

function biggestBlowout(games, viewerSide, leagueData) {
  let best = null;
  for (const g of games) {
    if (g.scoreA == null || g.scoreB == null) continue;
    const margin = Math.abs(g.scoreA - g.scoreB);
    if (!best || margin > best.margin) best = { game: g, margin };
  }
  if (!best) return null;
  return `${fmtGameLine(best.game, viewerSide, leagueData)} *(margin ${best.margin})*`;
}

function longestGap(games) {
  if (games.length < 2) return null;
  const sorted = [...games].sort(
    (a, b) => a.year - b.year || a.week - b.week
  );
  let best = null;
  for (let i = 1; i < sorted.length; i++) {
    const gap =
      (sorted[i].year - sorted[i - 1].year) * 17 +
      (sorted[i].week - sorted[i - 1].week);
    if (!best || gap > best.gap) {
      best = { gap, from: sorted[i - 1], to: sorted[i] };
    }
  }
  if (!best) return null;
  return `${best.from.year} → ${best.to.year} (${best.gap} weeks)`;
}

// ─── Mode handlers ──────────────────────────────────────────

async function teamMode(interaction, target) {
  const leagueData = getLatestLeagueData();
  const myTeam = leagueData
    ? await getUserTeam(leagueData, interaction.user.id)
    : null;

  if (!myTeam) {
    return interaction.editReply(
      "❌ I don't know which team you coach. Run `/iam` first."
    );
  }

  const myName = getTeamName(myTeam);
  const targetTeam = leagueData ? findTeamByName(leagueData, target) : null;
  const targetDisplay = targetTeam ? getTeamName(targetTeam) : target;

  const all = await loadAllGames();
  const games = all.filter(
    (g) =>
      (sameTeam(g.teamA, myName, leagueData) &&
        sameTeam(g.teamB, target, leagueData)) ||
      (sameTeam(g.teamB, myName, leagueData) &&
        sameTeam(g.teamA, target, leagueData))
  );

  if (!games.length) {
    return interaction.editReply(
      `No meetings between **${myName}** and **${targetDisplay}**.`
    );
  }

  const subject = teamSubjectFn(myName, leagueData);
  const record = recordFor(games, subject);
  const streak = currentStreak(games, subject);
  const counts = sourceCounts(games);

  const recentLines = games
    .slice(-10)
    .reverse()
    .map((g) => fmtGameLine(g, myName, leagueData));

  const blowout = biggestBlowout(games, myName, leagueData);
  const gap = longestGap(games);

  const embed = new EmbedBuilder()
    .setTitle(`H2H — ${myName} vs ${targetDisplay}`)
    .setColor(0x2980b9)
    .setDescription(
      `**${fmtRecord(record)}** (${fmtPct(record.pct)})  •  Streak **${fmtStreak(streak)}**  •  ${record.games} meeting${record.games === 1 ? '' : 's'}`
    )
    .addFields(
      {
        name: `Recent meetings (${Math.min(10, games.length)})`,
        value: trimField(recentLines.join('\n')),
      },
      {
        name: 'Notable',
        value: trimField(
          [
            blowout ? `**Biggest margin:** ${blowout}` : null,
            gap ? `**Longest gap:** ${gap}` : null,
          ]
            .filter(Boolean)
            .join('\n') || '—'
        ),
      }
    )
    .setFooter({
      text: `csv:${counts.csv} • json:${counts.json} • overrides:${counts.override}`,
    })
    .setTimestamp();

  const logo = getTeamLogoUrl ? getTeamLogoUrl(myTeam) : null;
  if (logo) embed.setThumbnail(logo);

  return interaction.editReply({ embeds: [embed] });
}

async function coachMode(interaction, target) {
  const leagueData = getLatestLeagueData();
  const myCoach = getUserCoachName(interaction.user.id);

  if (!myCoach) {
    return interaction.editReply(
      "❌ I don't know which coach you are. Run `/iam` first."
    );
  }

  const all = await loadAllGames();
  const hydrated = await hydrateCoachPerspective(all, myCoach);

  if (!hydrated.length) {
    return interaction.editReply(
      `No tracked games found for **${myCoach}** yet.`
    );
  }

  // Decide: is target a coach or a team?
  // Probe coachAttribution on the *opposing* side of every hydrated game.
  // If the opposing-side coach matches `target`, treat as coach-vs-coach.
  // Otherwise fall back to coach-vs-team.

  const matchedAsCoach = [];
  const matchedAsTeam = [];

  for (const g of hydrated) {
    const oppTeam = sameTeam(g.teamA, g.__subjectTeam, leagueData)
      ? g.teamB
      : g.teamA;

    const oppCoach = await coachAttribution(oppTeam, g.year, g.week);
    if (oppCoach && coachMatches(target, oppCoach)) {
      matchedAsCoach.push({
        ...g,
        __opponentCoach: oppCoach,
        __opponentTeam: oppTeam,
      });
      continue;
    }

    if (sameTeam(target, oppTeam, leagueData)) {
      matchedAsTeam.push({ ...g, __opponentTeam: oppTeam });
    }
  }

  const useCoach = matchedAsCoach.length > 0;
  const games = useCoach ? matchedAsCoach : matchedAsTeam;

  if (!games.length) {
    return interaction.editReply(
      `No meetings for **${myCoach}** vs **${target}**.`
    );
  }

  const subject = coachSubjectFn();
  const record = recordFor(games, subject);
  const streak = currentStreak(games, subject);
  const counts = sourceCounts(games);

  const recentLines = games
    .slice(-10)
    .reverse()
    .map((g) => fmtGameLine(g, g.__subjectTeam, leagueData));

  const blowout = biggestBlowout(
    games,
    games[games.length - 1].__subjectTeam,
    leagueData
  );
  const gap = longestGap(games);

  const titleSuffix = useCoach ? '(coach)' : '(team)';
  const embed = new EmbedBuilder()
    .setTitle(`H2H — ${myCoach} vs ${target} ${titleSuffix}`)
    .setColor(useCoach ? 0x9b59b6 : 0x2980b9)
    .setDescription(
      `**${fmtRecord(record)}** (${fmtPct(record.pct)})  •  Streak **${fmtStreak(streak)}**  •  ${record.games} meeting${record.games === 1 ? '' : 's'}`
    )
    .addFields(
      {
        name: `Recent meetings (${Math.min(10, games.length)})`,
        value: trimField(recentLines.join('\n')),
      },
      {
        name: 'Notable',
        value: trimField(
          [
            blowout ? `**Biggest margin:** ${blowout}` : null,
            gap ? `**Longest gap:** ${gap}` : null,
          ]
            .filter(Boolean)
            .join('\n') || '—'
        ),
      }
    )
    .setFooter({
      text: `csv:${counts.csv} • json:${counts.json} • overrides:${counts.override}`,
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
        .setName('target')
        .setDescription('Team or coach to compare against')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('scope')
        .setDescription('Whose perspective: my team or my coach')
        .setRequired(false)
        .addChoices(
          { name: 'team', value: 'team' },
          { name: 'coach', value: 'coach' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const target = interaction.options.getString('target');
    const scope = interaction.options.getString('scope') || 'team';

    try {
      if (scope === 'coach') {
        return await coachMode(interaction, target);
      }
      return await teamMode(interaction, target);
    } catch (err) {
      console.error('[h2h] failed:', err);
      return interaction.editReply(
        `❌ H2H lookup failed: ${err.message || err}`
      );
    }
  },
};
