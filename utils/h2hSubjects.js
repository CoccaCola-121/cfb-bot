// ============================================================
// utils/h2hSubjects.js
// Shared subject/opponent helpers for h2h, streaks, previews
// ============================================================

const { coachAttribution, coachAliasesFor } = require('./coachTenures');

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

function sameName(a, b) {
  return normalizeKey(a) === normalizeKey(b);
}

function coachMatches(inputCoach, actualCoach) {
  if (!inputCoach || !actualCoach) return false;

  const inputAliases = coachAliasesFor(inputCoach).map(normalizeKey);
  const actualAliases = coachAliasesFor(actualCoach).map(normalizeKey);

  for (const a of inputAliases) {
    if (actualAliases.includes(a)) return true;
  }

  return sameName(inputCoach, actualCoach);
}

function teamSubjectFn(team) {
  return (game) => {
    if (!sameName(game.teamA, team) && !sameName(game.teamB, team)) return null;
    return sameName(game.winner, team) ? 'win' : 'loss';
  };
}

function teamOpponentFn(team) {
  return (game) => {
    if (sameName(game.teamA, team)) return game.teamB;
    if (sameName(game.teamB, team)) return game.teamA;
    return null;
  };
}

async function coachSideForGame(game, coach) {
  const aCoach = await coachAttribution(game.teamA, game.year, game.week);
  const bCoach = await coachAttribution(game.teamB, game.year, game.week);

  if (coachMatches(coach, aCoach)) return game.teamA;
  if (coachMatches(coach, bCoach)) return game.teamB;

  return null;
}

async function coachResultForGame(game, coach) {
  const side = await coachSideForGame(game, coach);
  if (!side) return null;
  return sameName(game.winner, side) ? 'win' : 'loss';
}

async function hydrateCoachPerspective(games, coach) {
  const out = [];

  for (const game of games || []) {
    const side = await coachSideForGame(game, coach);
    if (!side) continue;

    out.push({
      ...game,
      __subjectTeam: side,
      __subjectCoach: coach,
      __subjectResult: sameName(game.winner, side) ? 'win' : 'loss',
    });
  }

  return out;
}

function hydratedCoachSubjectFn() {
  return (game) => game.__subjectResult || null;
}

function hydratedCoachOpponentTeamFn() {
  return (game) => {
    if (!game.__subjectTeam) return null;
    return sameName(game.teamA, game.__subjectTeam) ? game.teamB : game.teamA;
  };
}

module.exports = {
  normalizeKey,
  sameName,
  coachMatches,
  teamSubjectFn,
  teamOpponentFn,
  coachSideForGame,
  coachResultForGame,
  hydrateCoachPerspective,
  hydratedCoachSubjectFn,
  hydratedCoachOpponentTeamFn,
};