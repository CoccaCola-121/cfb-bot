// ============================================================
//  utils/weekLabels.js
// ============================================================

const REG_SEASON_WEEKS = 12;

function isPostseason(week) {
  return Number(week) > REG_SEASON_WEEKS;
}

function getWeekLabel(week) {
  const w = Number(week);

  if (!Number.isFinite(w)) {
    return 'Week ?';
  }

  if (w >= 1 && w <= REG_SEASON_WEEKS) {
    return `Week ${w}`;
  }

  const map = {
    13: 'Conference Championships',
    14: 'Bowl Week',
    15: 'Quarterfinals',
    16: 'Semifinals',
    17: 'National Championship',
  };

  return map[w] || `Postseason Wk ${w}`;
}

module.exports = {
  REG_SEASON_WEEKS,
  isPostseason,
  getWeekLabel,
};