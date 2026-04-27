// ============================================================
// commands/h2h.js
// Head-to-head command with team, coach, and team-vs-team modes
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const { getLatestLeagueData, getTeamName, findTeamByName } = require('../utils/data');
const { getUserCoachName, getUserTeam } = require('../utils/userMap');
const { loadAllGames } = require('../utils/h2hData');
const { currentStreak, recordFor } = require('../utils/streakEngine');
const {
  sameName,
  teamSubjectFn,
  hydrateCoachPerspective,
  hydratedCoachSubjectFn,
  hydratedCoachOpponentTeamFn,
  coachMatches,
} = require('../utils/h2hSubjects');
const { coachAttribution } = require('../utils/coachTenures');

function fmtPct(wins, losses) {
  const total = wins + losses;
  if (!total) return '.000';
  return (wins / total).toFixed(3).replace(/^0/, '');
}

function fmtWeek(game) {
  return game.weekLabel || `W${game.week}`;
}

function sourceCounts(games) {
  const counts = {};
  for (const g of games || []) {
    counts[g.source || 'unknown'] = (counts[g.source || 'unknown'] || 0) + 1;
  }

  const parts = [];
  if (counts.csv) parts.push(`${counts.csv} CSV`);
  if (counts.json) parts.push(`${counts.json} JSON`);
  if (counts['override-add'] || counts.override) {
    parts.push(`${(counts['override-add'] || 0) + (counts.override || 0)} override`);
  }

  return parts.length ? parts.join(' · ') : '0 games';
}

function gameLine(game, subjectFn) {
  const result = subjectFn(game);
  const tag = result === 'win' ? 'W' : result === 'loss' ? 'L' : '—';

  return `${game.year} ${fmtWeek(game)} — ${game.teamA} ${game.scoreA}, ${game.teamB} ${game.scoreB} (${tag})`;
}

function biggestBlowout(games) {
  if (!games.length) return null;

  let best = null;
  for (const g of games) {
    const margin = Math.abs(Number(g.scoreA || 0) - Number(g.scoreB || 0));
    if (!best || margin > best.margin) {
      best = { game: g, margin };
    }
  }

  return best;
}

function longestGap(games) {
  if (games.length < 2) return null;

  const sorted = [...games].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.week - b.week
  );

  let best = null;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const gap = (cur.year - prev.year) * 20 + (cur.week - prev.week);

    if (!best || gap > best.gap) {
      best = { gap, from: prev, to: cur };
    }
  }

  return best;
}

function resolveTeamName(leagueData, input) {
  if (!input) return null;

  const team = findTeamByName
    ? findTeamByName(leagueData, input)
    : null;

  return team ? getTeamName(team) : String(input).trim();
}

async function filterCoachVsCoach(allGames, coachA, coachB) {
  const aGames = await hydrateCoachPerspective(allGames, coachA);
  const out = [];

  for (const g of aGames) {
    const oppTeam = hydratedCoachOpponentTeamFn()(g);
    if (!oppTeam) continue;

    const oppCoach = await coachAttribution(oppTeam, g.year, g.week);
    if (coachMatches(coachB, oppCoach)) out.push(g);
  }

  return out;
}

async function filterCoachVsTeam(allGames, coach, team) {
  const coachGames = await hydrateCoachPerspective(allGames, coach);

  return coachGames.filter((g) => {
    const opp = hydratedCoachOpponentTeamFn()(g);
    return sameName(opp, team);
  });
}

function filterTeamVsTeam(allGames, teamA, teamB) {
  return allGames.filter(
    (g) =>
      (sameName(g.teamA, teamA) && sameName(g.teamB, teamB)) ||
      (sameName(g.teamA, teamB) && sameName(g.teamB, teamA))
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('h2h')
    .setDescription('Show head-to-head records.')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('H2H mode')
        .setRequired(false)
        .addChoices(
          { name: 'team', value: 'team' },
          { name: 'coach', value: 'coach' },
          { name: 'team-vs-team', value: 'team-vs-team' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('opponent')
        .setDescription('Opponent team or coach')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('me_coach')
        .setDescription('Override your linked coach name')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('me_team')
        .setDescription('Override your linked team for team-vs-team mode')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const mode = interaction.options.getString('mode') || 'team';
    const opponentRaw = interaction.options.getString('opponent');
    const meCoachRaw = interaction.options.getString('me_coach');
    const meTeamRaw = interaction.options.getString('me_team');

    const allGames = await loadAllGames();

    let subjectLabel = '';
    let opponentLabel = '';
    let games = [];
    let subjectFn = null;

    if (mode === 'team-vs-team') {
      const linkedTeam = await getUserTeam(leagueData, interaction.user.id);
      const subjectTeam =
        resolveTeamName(leagueData, meTeamRaw) ||
        (linkedTeam ? getTeamName(linkedTeam) : null);

      if (!subjectTeam) {
        return interaction.editReply(
          '❌ No team specified and no linked team found. Use `me_team:` or run `/iam` first.'
        );
      }

      const opponentTeam = resolveTeamName(leagueData, opponentRaw);

      subjectLabel = subjectTeam;
      opponentLabel = opponentTeam;

      games = filterTeamVsTeam(allGames, subjectTeam, opponentTeam);
      subjectFn = teamSubjectFn(subjectTeam);
    } else if (mode === 'coach') {
      const subjectCoach =
        meCoachRaw ||
        getUserCoachName(interaction.user.id);

      if (!subjectCoach) {
        return interaction.editReply(
          '❌ No coach specified and no linked coach found. Use `me_coach:` or run `/iam` first.'
        );
      }

      const opponentCoach = opponentRaw;

      subjectLabel = subjectCoach;
      opponentLabel = opponentCoach;

      games = await filterCoachVsCoach(allGames, subjectCoach, opponentCoach);
      subjectFn = hydratedCoachSubjectFn();
    } else {
      const subjectCoach =
        meCoachRaw ||
        getUserCoachName(interaction.user.id);

      if (!subjectCoach) {
        return interaction.editReply(
          '❌ No coach specified and no linked coach found. Use `me_coach:` or run `/iam` first.'
        );
      }

      const opponentTeam = resolveTeamName(leagueData, opponentRaw);

      subjectLabel = subjectCoach;
      opponentLabel = opponentTeam;

      games = await filterCoachVsTeam(allGames, subjectCoach, opponentTeam);
      subjectFn = hydratedCoachSubjectFn();
    }

    const record = recordFor(games, subjectFn);
    const streak = currentStreak(games, subjectFn);

    const desc =
      record.games > 0
        ? `All-time: **${record.wins}-${record.losses}** (${fmtPct(record.wins, record.losses)})` +
          (streak ? ` · Streak: **${streak.label}**` : '')
        : '0 meetings on record.';

    const embed = new EmbedBuilder()
      .setTitle(`H2H — ${subjectLabel} vs ${opponentLabel}`)
      .setDescription(desc)
      .setColor(0x2f80ed)
      .setTimestamp();

    if (games.length) {
      const recent = [...games]
        .sort((a, b) => {
          if (b.year !== a.year) return b.year - a.year;
          return b.week - a.week;
        })
        .slice(0, 10)
        .map((g) => gameLine(g, subjectFn))
        .join('\n');

      embed.addFields({
        name: 'Recent meetings',
        value: recent || '—',
      });

      const notes = [];

      const blowout = biggestBlowout(games);
      if (blowout) {
        notes.push(
          `Biggest blowout: ${blowout.margin} pts, ${blowout.game.year} ${fmtWeek(blowout.game)}`
        );
      }

      const gap = longestGap(games);
      if (gap) {
        notes.push(
          `Longest gap: ${gap.from.year} ${fmtWeek(gap.from)} to ${gap.to.year} ${fmtWeek(gap.to)}`
        );
      }

      if (notes.length) {
        embed.addFields({
          name: 'Notable',
          value: notes.join('\n'),
        });
      }
    }

    embed.setFooter({
      text: `${sourceCounts(allGames)} · Last loaded: ${new Date().toLocaleString('en-US', {
        timeZone: 'America/Chicago',
      })}`,
    });

    return interaction.editReply({ embeds: [embed] });
  },
};