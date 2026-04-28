// ============================================================
// commands/familytree.js
//
// /familytree [as:team|coach]
//
// Computes a "dominance score" per opponent and surfaces:
//   👨‍👦 Sons   — top 3 opponents you have dominated (positive score)
//   🧓 Fathers  — top 3 opponents who have dominated you (negative)
//
// Dominance:
//   const MIN_GAMES = 3;
//   const margin    = wins - losses;
//   return margin * Math.log2(games + 1);
//
// Pulls the same canonical game ledger as /h2h and /streaks via utils/h2h.js.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const {
  loadAllGames,
  sameTeam,
  teamSubjectFn,
  teamOpponentFn,
  hydrateCoachPerspective,
  coachSubjectFn,
} = require('../utils/h2h');

const { recordVs, dominanceScore } = require('../utils/streakEngine');
const { coachAttribution } = require('../utils/coachTenures');
const { getUserCoachName, getUserTeam } = require('../utils/userMap');
const {
  getLatestLeagueData,
  getTeamName,
  getTeamLogoUrl,
} = require('../utils/data');

const MIN_GAMES = 3;

// ─── Helpers ────────────────────────────────────────────────

function fmtPct(p) {
  if (!Number.isFinite(p)) return '—';
  return (p * 100).toFixed(1) + '%';
}

function buildDominanceRows(map) {
  const rows = [];
  for (const row of map.values()) {
    const score = dominanceScore(row.wins, row.losses, MIN_GAMES);
    if (score == null) continue;
    rows.push({
      opponent: row.opponent,
      wins: row.wins,
      losses: row.losses,
      games: row.games,
      pct: row.games > 0 ? row.wins / row.games : 0,
      score,
      lastYear: row.lastGame?.year ?? null,
    });
  }
  return rows;
}

function sortByDominance(rows, direction /* 'asc' | 'desc' */) {
  return [...rows].sort((a, b) => {
    if (direction === 'desc') {
      if (b.score !== a.score) return b.score - a.score;
      if (b.wins !== a.wins) return b.wins - a.wins;
    } else {
      if (a.score !== b.score) return a.score - b.score;
      if (b.losses !== a.losses) return b.losses - a.losses;
    }
    if ((b.lastYear ?? 0) !== (a.lastYear ?? 0)) return (b.lastYear ?? 0) - (a.lastYear ?? 0);
    return String(a.opponent).localeCompare(String(b.opponent));
  });
}

function fmtRow(r, idx) {
  const rank = `**${idx + 1}.**`;
  const wl = `${r.wins}-${r.losses}`;
  const last = r.lastYear ? ` · *last ${r.lastYear}*` : '';
  // dominance: signed integer-ish display
  const dom = (r.score >= 0 ? '+' : '') + r.score.toFixed(1);
  return `${rank} **${r.opponent}** — ${wl} (${fmtPct(r.pct)}) · dom \`${dom}\`${last}`;
}

function trimField(text, max = 1024) {
  if (!text) return '_None qualify (need ≥ ' + MIN_GAMES + ' games)_';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

// ─── Mode handlers ──────────────────────────────────────────

async function teamMode(interaction) {
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
  const subjectFn  = teamSubjectFn(myName, leagueData);
  const opponentFn = teamOpponentFn(myName, leagueData);

  const games = allGames.filter(
    (g) =>
      sameTeam(g.teamA, myName, leagueData) ||
      sameTeam(g.teamB, myName, leagueData),
  );

  if (!games.length) {
    return interaction.editReply(`No games found for **${myName}**.`);
  }

  const map = recordVs(games, subjectFn, opponentFn);
  const rows = buildDominanceRows(map);
  const sons    = sortByDominance(rows.filter((r) => r.score >  0), 'desc').slice(0, 3);
  const fathers = sortByDominance(rows.filter((r) => r.score <  0), 'asc' ).slice(0, 3);

  const sonsText    = sons.length    ? sons.map(fmtRow).join('\n')    : null;
  const fathersText = fathers.length ? fathers.map(fmtRow).join('\n') : null;

  const embed = new EmbedBuilder()
    .setTitle(`🌳 ${myName} · Family Tree`)
    .setColor(0x16a085)
    .setDescription(
      `Opponents are ranked by **dominance** *(margin × log₂(games+1))*. Need ≥ ${MIN_GAMES} games to qualify.`,
    )
    .addFields(
      { name: '👨‍👦 Sons (you dominate)',  value: trimField(sonsText)    },
      { name: '🧓 Fathers (they dominate)', value: trimField(fathersText) },
    )
    .setFooter({
      text: `${games.length} game${games.length === 1 ? '' : 's'} · ${rows.length} qualifying opponent${rows.length === 1 ? '' : 's'}`,
    })
    .setTimestamp();

  if (myTeam && getTeamLogoUrl) {
    const logo = getTeamLogoUrl(myTeam);
    if (logo) embed.setThumbnail(logo);
  }

  return interaction.editReply({ embeds: [embed] });
}

async function coachMode(interaction) {
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

  // Tag opponent coach (fall back to team) so the "child" group is the coach
  // identity when known — which matches /h2h coach mode.
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

    enriched.push({
      ...g,
      __opponentTeam: oppTeam,
      __opponentCoach: oppCoach,
      __opponentLabel: oppCoach || oppTeam,
    });
  }

  const subjectFn = coachSubjectFn();
  const opponentFn = (g) => g.__opponentLabel;

  const map = recordVs(enriched, subjectFn, opponentFn);
  const rows = buildDominanceRows(map);
  const sons    = sortByDominance(rows.filter((r) => r.score >  0), 'desc').slice(0, 3);
  const fathers = sortByDominance(rows.filter((r) => r.score <  0), 'asc' ).slice(0, 3);

  const sonsText    = sons.length    ? sons.map(fmtRow).join('\n')    : null;
  const fathersText = fathers.length ? fathers.map(fmtRow).join('\n') : null;

  const embed = new EmbedBuilder()
    .setTitle(`🌳 ${myCoach} · Career Family Tree`)
    .setColor(0x9b59b6)
    .setDescription(
      `Opponents are ranked by **dominance** *(margin × log₂(games+1))*. Need ≥ ${MIN_GAMES} games to qualify.`,
    )
    .addFields(
      { name: '👨‍👦 Sons (you dominate)',  value: trimField(sonsText)    },
      { name: '🧓 Fathers (they dominate)', value: trimField(fathersText) },
    )
    .setFooter({
      text: `${enriched.length} game${enriched.length === 1 ? '' : 's'} · ${rows.length} qualifying opponent${rows.length === 1 ? '' : 's'}`,
    })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// ─── Slash command ──────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('familytree')
    .setDescription('Top opponents you dominate (sons) and who dominate you (fathers).')
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

    const as = interaction.options.getString('as') || 'team';

    try {
      if (as === 'coach') {
        return await coachMode(interaction);
      }
      return await teamMode(interaction);
    } catch (err) {
      console.error('[familytree] failed:', err);
      return interaction.editReply(
        `❌ Family tree lookup failed: ${err.message || err}`,
      );
    }
  },
};
