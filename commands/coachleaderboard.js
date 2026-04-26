// ============================================================
//  commands/coachleaderboard.js  —  top 10 active coaches
//
//  Data sources:
//    - Coach CSV (NZCFL Info sheet): CCG wins, nat titles,
//      years coached, promises kept/failed
//    - Coach Resume sheet (main tab): career W/L record
//    - Formula: wins + win% + CCG titles + nat titles,
//      tiny promise bonus, no loyalty score
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { normalize } = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');
const {
  getLatestLeagueData,
  getCurrentSeason,
  getLatestTeamSeason,
  getTeamName,
  safeNumber,
} = require('../utils/data');
const { applyOverridesToLeaderboardRecord } = require('../utils/coachOverrides');
const { NAT_TITLE_ASTERISK } = require('../utils/natTitles');

const COACH_SHEET_ID   = process.env.NZCFL_COACH_SHEET_ID  || '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';
const COACH_SHEET_TAB  = process.env.NZCFL_COACH_SHEET_TAB || 'Coach';

// Coach resume sheet — only used for career W/L totals
const RESUME_SHEET_ID  = '1S3EcS3V6fxfN5qxF6R-MSb763AL6W11W-QqytehCUkU';
const RESUME_GID       = '1607727992';

// ── Parse coach CSV ──────────────────────────────────────────
function parseCoachCsv(rows) {
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    if (rows[i].some(c => c.toLowerCase().includes('coach') && c.toLowerCase() !== 'coach rankings')) {
      hi = i; break;
    }
  }
  if (hi === -1) hi = 1;

  const coaches = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r     = rows[i];
    const coach = (r[0] || '').trim();
    const team  = (r[1] || '').trim();
    if (!team || !coach) continue;

    const n  = (idx, def = 0) => { const v = parseFloat(r[idx]); return isNaN(v) ? def : v; };
    const ni = (idx, def = 0) => Math.round(n(idx, def));

    coaches.push({
      coach,        team,
      years:        ni(4),
      promFailed:   ni(5),
      promKept:     ni(6),
      bowlWins:     ni(10),
      divTitles:    ni(11),
      confTitles:   ni(12),
      playoffs:     ni(13),
      natTitles:    ni(14),
    });
  }
  return coaches;
}

// ── League-team lookup by fuzzy name ─────────────────────────
function findLeagueTeamByName(leagueData, name) {
  if (!leagueData?.teams) return null;
  const target = normalize(name);
  if (!target) return null;
  return (
    leagueData.teams.find(
      (t) =>
        !t.disabled &&
        (normalize(getTeamName(t)) === target ||
          normalize(t.region) === target ||
          normalize(t.name) === target ||
          normalize(t.abbrev) === target)
    ) || null
  );
}

// Add the current in-progress season's W/L onto a coach's resume totals so the
// leaderboard reflects live records, matching /coachstats behavior.
function patchRecordWithCurrentSeason(leagueData, coach, record) {
  if (!record) return record;
  if (!leagueData) return record;

  const currentSeason = getCurrentSeason(leagueData);
  if (currentSeason === null || currentSeason === undefined) return record;

  const leagueTeam = findLeagueTeamByName(leagueData, coach.team);
  if (!leagueTeam) return record;

  const seas = getLatestTeamSeason(leagueTeam, currentSeason);
  if (!seas) return record;

  const liveW = safeNumber(seas.won);
  const liveL = safeNumber(seas.lost);
  if (liveW + liveL === 0) return record;

  const totalW = record.wins + liveW;
  const totalL = record.losses + liveL;
  const games = totalW + totalL;

  return {
    ...record,
    wins: totalW,
    losses: totalL,
    pct: games > 0 ? totalW / games : 0,
    record: `${totalW}-${totalL}`,
  };
}

// ── Parse resume sheet for career W/L ───────────────────────
// Returns Map<normalizedCoachName, { wins, losses, pct, record, history }>
// `history` is [{ year, record }] — needed so /recordupdate overrides can
// subtract the original year's W/L before adding the new one.
function parseResumeSheet(rows) {
  const map = new Map();

  // Find header: row containing 'Coach' and 'Total'
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map(c => c.toLowerCase().trim());
    if (r.includes('coach') && r.includes('total')) { hi = i; break; }
  }
  if (hi === -1) return map;

  const header   = rows[hi].map(c => c.trim());
  const coachCol = header.findIndex(h => h.toLowerCase() === 'coach');
  const totalCol = header.findIndex(h => h.toLowerCase() === 'total');
  if (coachCol === -1 || totalCol === -1) return map;

  // Year columns appear twice (record block, then team block). We only
  // need the first (record) block here.
  const yearIdxs = header.map((h, i) => (/^\d{4}$/.test(h) ? i : -1)).filter(i => i >= 0);
  const seen = new Set(); let splitAt = -1;
  for (let i = 0; i < yearIdxs.length; i++) {
    const y = header[yearIdxs[i]];
    if (seen.has(y)) { splitAt = i; break; }
    seen.add(y);
  }
  const recordYearCols = splitAt >= 0 ? yearIdxs.slice(0, splitAt) : yearIdxs;

  for (let i = hi + 1; i < rows.length; i++) {
    const r     = rows[i];
    const coach = (r[coachCol] || '').trim();
    const total = (r[totalCol] || '').trim();
    if (!coach || !total) continue;

    const m = total.match(/^(\d+)-(\d+)$/);
    if (!m) continue;

    const wins   = parseInt(m[1]);
    const losses = parseInt(m[2]);
    const games  = wins + losses;

    const history = [];
    for (const col of recordYearCols) {
      const y = header[col];
      const v = (r[col] || '').trim();
      if (v && /^\d{1,2}-\d{1,2}$/.test(v)) history.push({ year: y, record: v });
    }
    history.sort((a, b) => +a.year - +b.year);

    map.set(normalize(coach), {
      wins,
      losses,
      pct: games > 0 ? wins / games : 0,
      record: total,
      history,
    });
  }
  return map;
}

// ── Formula ──────────────────────────────────────────────────
// Heavily weighted toward wins, win%, CCG titles, nat titles.
// Promises kept/failed: tiny nudge only.
function computeScore(c, record) {
  if (!record || c.years < 1) return 0;
  return (record.wins  * 1.0)
       + (record.pct   * 80)
       + (c.natTitles  * 120)
       + (c.confTitles * 18)
       + (c.divTitles  * 5)
       + (c.playoffs   * 1.5);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coachleaderboard')
    .setDescription('Top 10 active coaches')
    .addStringOption(opt =>
      opt.setName('sort').setDescription('Sort by (default: formula)').setRequired(false)
        .addChoices(
          { name: 'Formula Score',       value: 'formula'  },
          { name: 'Conf. Titles',        value: 'conf'     },
          { name: 'National Titles',     value: 'nat'      },
          { name: 'Career Wins',         value: 'wins'     },
          { name: 'Win %',               value: 'pct'      },
          { name: 'Years Coached',       value: 'years'    },
          { name: 'Playoff Appearances', value: 'playoffs' },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    let csvRows, resumeRows;
    try {
      [csvRows, resumeRows] = await Promise.all([
        fetchSheetCsv(COACH_SHEET_ID, COACH_SHEET_TAB),
        fetchSheetCsv(RESUME_SHEET_ID, RESUME_GID, true),
      ]);
    } catch (err) {
      return interaction.editReply(`❌ Could not load data: ${err.message}`);
    }

    const coaches   = parseCoachCsv(csvRows).filter(c => c.years > 0);
    const recordMap = parseResumeSheet(resumeRows);
    const leagueData = getLatestLeagueData();

    if (!coaches.length) return interaction.editReply('❌ No coach data found.');

    // Attach career record to each coach, patched with the current in-progress
    // season from the latest league export (resume sheet totals exclude live
    // seasons, so /teamstats & /coachstats would otherwise show more wins).
    // Then apply the coach's manual /recordupdate overrides on top so any
    // half-season adjustments are reflected on the leaderboard too.
    const enriched = coaches.map(c => {
      const baseRecord  = recordMap.get(normalize(c.coach)) || null;
      const livePatched = patchRecordWithCurrentSeason(leagueData, c, baseRecord);
      const finalRecord = applyOverridesToLeaderboardRecord(
        livePatched,
        c.coach,
        baseRecord?.history || null
      );
      return {
        ...c,
        record: finalRecord,
      };
    });

    const sort = interaction.options.getString('sort') || 'formula';

    const sorted = [...enriched].sort((a, b) => {
      switch (sort) {
        case 'conf':
          return b.confTitles - a.confTitles || b.natTitles - a.natTitles || b.years - a.years;
        case 'nat':
          return b.natTitles - a.natTitles || b.confTitles - a.confTitles || b.years - a.years;
        case 'wins':
          return (b.record?.wins ?? 0) - (a.record?.wins ?? 0);
        case 'pct':
          return (b.record?.pct ?? 0) - (a.record?.pct ?? 0);
        case 'years':
          return b.years - a.years || b.confTitles - a.confTitles;
        case 'playoffs':
          return b.playoffs - a.playoffs || b.confTitles - a.confTitles;
        default:
          return computeScore(b, b.record) - computeScore(a, a.record);
      }
    });

    const top = sorted.slice(0, 10);

    const sortLabels = {
      formula:  'Formula',
      conf:     'Conf. Titles',
      nat:      'National Titles',
      wins:     'Career Wins',
      pct:      'Win %',
      years:    'Years Coached',
      playoffs: 'Playoff Appearances',
    };

    const lines = top.map((c, idx) => {
      const rank = String(idx + 1).padStart(2);

      const recStr = c.record
        ? `${c.record.record} (${c.record.pct.toFixed(3)})`
        : '—';

      const asterisk = NAT_TITLE_ASTERISK.has(c.coach) ? '*' : '';
      const natStr   = `${c.natTitles}${asterisk}`;
      const confStr  = String(c.confTitles);

      return (
        `\`${rank}.\` **${c.coach}** — ${c.team}\n` +
        `      ${recStr}  ·  ${confStr} CCG  ·  ${natStr} natl`
      );
    });

    const embed = new EmbedBuilder()
      .setTitle(`🏈 Coach Leaderboard — ${sortLabels[sort] || 'Formula'}`)
      .setColor(0x2b4b8c)
      .setDescription(lines.join('\n\n'))
      .setFooter({ text: 'Active coaches only · Career record from resume sheet' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
