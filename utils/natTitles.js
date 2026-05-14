// ============================================================
//  utils/natTitles.js
//
//  National championship history. Coaches are matched by aliases
//  (Discord handles, nicknames, etc.) using normalize() so the
//  same data powers /coachstats, /championships, /teamhistory,
//  /dynastytracker, etc.
//
//  Add new entries here as the season concludes.
// ============================================================

const { normalize } = require('./sheets');

// year (string), aliases (array of strings).
// Sorted ascending by year — keep in chronological order.
const NAT_TITLE_ENTRIES = [
  { year: '2016', aliases: ['evilman2011'] },
  { year: '2017', aliases: ['unknownuser', '@unknownuser'] },
  { year: '2018', aliases: ['benjay67'] },
  { year: '2019', aliases: ['nick', '@nick'] },
  { year: '2020', aliases: ['nick', '@nick'] },
  { year: '2021', aliases: ['bigdragondaddy', '@bigdragondaddy'] },
  { year: '2022', aliases: ['bigdragondaddy', '@bigdragondaddy'] },
  { year: '2023', aliases: ['julio', '@julio'] },
  { year: '2024', aliases: ['julio', '@julio'] },
  { year: '2025', aliases: ['sezenack', '@sezenack'] },
  { year: '2026', aliases: ['xboy623'] },
  { year: '2027', aliases: ['@.', '.'] },
  { year: '2028', aliases: ['mako22', 'mako_22'] },
  { year: '2029', aliases: ['sweatpantsdv', '@sweatpantsdv'] },
  { year: '2030', aliases: ['citrojek', '@citrojek'] },
  { year: '2031', aliases: ['thunderwolf53', '@thunderwolf53'] },
  { year: '2032', aliases: ['sweatpantsdv', '@sweatpantsdv'] },
  { year: '2033', aliases: ['citrojek', '@citrojek'] },
  { year: '2035', aliases: ['thedondraper'] },
  { year: '2036', aliases: ['dogwoodmaple', '@dogwoodmaple'] },
  { year: '2037', aliases: ['sweatpantsdv', '@sweatpantsdv'] },
  { year: '2038', aliases: ['angel', "angel's", "@angel's", '@angel'] },
  { year: '2039', aliases: ['cashmikey', 'cashmikeygocats', '@cashmikey'] },
  { year: '2040', aliases: ['unholy', '@unholy'] },
  { year: '2041', aliases: ['thedondraper'] },
  { year: '2042', aliases: ['jeremy', '@jeremy'] },
  { year: '2043', aliases: ['sweatpantsdv', '@sweatpantsdv'] },
  { year: '2044', aliases: ['bigdragondaddy', '@bigdragondaddy'] },
  { year: '2045', aliases: ['vin', '@vin'] },
  { year: '2046', aliases: ['aeroman', '@aeroman'] },
  { year: '2047', aliases: ['circl', '@circl'] },
  { year: '2048', aliases: ['jt', '@jt'] },
  { year: '2049', aliases: ['poke', '@poke'] },
  { year: '2050', aliases: ['jt', '@jt'] },
  { year: '2051', aliases: ['mr.goodcookie', '@mr.goodcookie', 'mrgoodcookie', 'goodcookie', 'coachmrcap', '@coachmrcap', 'mrcap', '@mr.cap'] },
  { year: '2052', aliases: ['dogwoodmaple', '@dogwoodmaple'] },
  { year: '2053', aliases: ['dippyflip', '@dippyflip'] },
  { year: '2054', aliases: ['secret', '@secret'] },
  { year: '2055', aliases: ['circl', '@circl'] },
  { year: '2056', aliases: ['coachrich2x', '@coachrich2x', 'coachrich'] },
  { year: '2057', aliases: ['coachrich2x', '@coachrich2x', 'coachrich'] },
  { year: '2058', aliases: ['amok', '@amok'] },
  { year: '2059', aliases: ['legend', '@legend'] },
];

// Return the years a given coach won the national title (alias-matched).
// Uses fuzzy substring matching once the alias is at least 4 chars long.
function getNatTitleYears(coachName) {
  const rk = normalize(coachName);
  if (!rk) return [];
  return NAT_TITLE_ENTRIES
    .filter((e) =>
      e.aliases.some((a) => {
        const an = normalize(a);
        return (
          an === rk ||
          (an.length >= 4 && rk.includes(an)) ||
          (rk.length >= 4 && an.includes(rk))
        );
      })
    )
    .map((e) => e.year);
}

module.exports = {
  NAT_TITLE_ENTRIES,
  getNatTitleYears,
};
