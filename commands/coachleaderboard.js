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
const { fetchSheetCsv, normalize } = require('../utils/sheets');

const COACH_SHEET_ID   = process.env.NZCFL_COACH_SHEET_ID  || '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';
const COACH_SHEET_TAB  = process.env.NZCFL_COACH_SHEET_TAB || 'Coach';

// Coach resume sheet — only used for career W/L totals
const RESUME_SHEET_ID  = '1S3EcS3V6fxfN5qxF6R-MSb763AL6W11W-QqytehCUkU';
const RESUME_GID       = '1607727992';

const NAT_TITLE_ASTERISK = new Set(['legend', 'LEGEND']);

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

// ── Parse resume sheet for career W/L ───────────────────────
// Returns Map<normalizedCoachName, { wins, losses, pct }>
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
    map.set(normalize(coach), {
      wins,
      losses,
      pct: games > 0 ? wins / games : 0,
      record: total,
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

    if (!coaches.length) return interaction.editReply('❌ No coach data found.');

    // Attach career record to each coach
    const enriched = coaches.map(c => ({
      ...c,
      record: recordMap.get(normalize(c.coach)) || null,
    }));

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
