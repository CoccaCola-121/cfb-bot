// ============================================================
// utils/h2hSubjects.js
// DEPRECATED. Consolidated into utils/h2h.js.
// Kept as a thin re-export so existing imports keep working.
// ============================================================

const {
  normKey,
  sameTeam,
  coachMatches,
  teamSubjectFn,
  teamOpponentFn,
  coachSideForGame,
  hydrateCoachPerspective,
  coachSubjectFn,
  coachOpponentTeamFn,
} = require('./h2h');

// Legacy aliases used by older callers
module.exports = {
  normalizeKey: normKey,
  sameName: sameTeam,
  coachMatches,
  teamSubjectFn,
  teamOpponentFn,
  coachSideForGame,
  coachResultForGame: async (game, coach) => {
    const side = await coachSideForGame(game, coach);
    if (!side || !game.winner) return null;
    return sameTeam(game.winner, side) ? 'win' : 'loss';
  },
  hydrateCoachPerspective,
  hydratedCoachSubjectFn: coachSubjectFn,
  hydratedCoachOpponentTeamFn: coachOpponentTeamFn,
};
