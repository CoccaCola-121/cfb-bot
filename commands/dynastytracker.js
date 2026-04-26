// ============================================================
//  commands/dynastytracker.js
//
//  A "dynasty" = an unbroken stretch of N+ consecutive seasons
//  where a single coach stayed at one program. Default N = 5.
//
//  Pulls from the Resume sheet (cached). Sorted longest first,
//  ties broken by win percentage. Use `min` to widen/narrow
//  the cutoff (3 = warmer cutoff, 7 = elite only) and `coach`
//  to filter to a specific coach.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { normalize } = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');

const RESUME_SHEET_ID = '1S3EcS3V6fxfN5qxF6R-MSb763AL6W11W-QqytehCUkU';
const RESUME_GID      = '1607727992';

// Reuse the Resume parser shape from teamhistory.js (kept local
// here so this file stays self-contained — it's the same logic).
function parseResumeRows(rows) {
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map((c) => c.toLowerCase().trim());
    if (r.includes('coach') && r.includes('total')) { hi = i; break; }
  }
  if (hi === -1) return [];

  const header   = rows[hi].map((c) => c.trim());
  const coachCol = header.findIndex((h) => h.toLowerCase() === 'coach');
  if (coachCol === -1) return [];

  const yearIdxs = header.map((h, i) => (/^\d{4}$/.test(h) ? i : -1)).filter((i) => i >= 0);
  const seen = new Set(); let splitAt = -1;
  for (let i = 0; i < yearIdxs.length; i++) {
    const y = header[yearIdxs[i]];
    if (seen.has(y)) { splitAt = i; break; }
    seen.add(y);
  }
  const recordYearCols = splitAt >= 0 ? yearIdxs.slice(0, splitAt) : yearIdxs;
  const teamYearCols   = splitAt >= 0 ? yearIdxs.slice(splitAt)    : [];

  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const coach = (r[coachCol] || '').trim();
    if (!coach) continue;

    const recordByYear = new Map();
    for (const col of recordYearCols) {
      const y = header[col];
      const v = (r[col] || '').trim();
      if (v && /^\d{1,2}-\d{1,2}$/.test(v)) recordByYear.set(y, v);
    }
    const teamByYear = new Map();
    for (const col of teamYearCols) {
      const y = header[col];
      const v = (r[col] || '').trim();
      if (v) teamByYear.set(y, v);
    }

    const allYears = [...new Set([...recordByYear.keys(), ...teamByYear.keys()])];
    for (const y of allYears) {
      const rec  = recordByYear.get(y);
      const team = teamByYear.get(y);
      const m = rec ? rec.match(/^(\d+)-(\d+)$/) : null;
      out.push({
        year:   y,
        coach,
        team:   team || null,
        wins:   m ? +m[1] : 0,
        losses: m ? +m[2] : 0,
      });
    }
  }
  return out;
}

// For one coach's rows, produce dynasty spans (consecutive years at same team).
function buildDynastyRunsForCoach(coach, rows) {
  // Group by team-then-sort-by-year approach: one pass works because
  // we only fold consecutive year+sameTeam. Sort by year asc.
  const sorted = [...rows].sort((a, b) => +a.year - +b.year);

  const spans = [];
  let cur = null;
  for (const r of sorted) {
    if (!r.team) continue;
    if (
      cur &&
      normalize(cur.team) === normalize(r.team) &&
      +r.year === +cur.endYear + 1
    ) {
      cur.endYear = r.year;
      cur.years  += 1;
      cur.wins   += r.wins;
      cur.losses += r.losses;
    } else {
      if (cur) spans.push(cur);
      cur = {
        coach,
        team:      r.team,
        startYear: r.year,
        endYear:   r.year,
        years:     1,
        wins:      r.wins,
        losses:    r.losses,
      };
    }
  }
  if (cur) spans.push(cur);
  return spans;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dynastytracker')
    .setDescription('Multi-year tenures at a single program (longest first)')
    .addIntegerOption((opt) =>
      opt
        .setName('min')
        .setDescription('Minimum consecutive seasons to qualify (default 5)')
        .setRequired(false)
        .setMinValue(2)
        .setMaxValue(20)
    )
    .addStringOption((opt) =>
      opt.setName('coach').setDescription('Filter to one coach').setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const minYears = interaction.options.getInteger('min') || 5;
    const coachArg = interaction.options.getString('coach');

    let resumeRows;
    try {
      resumeRows = await fetchSheetCsv(RESUME_SHEET_ID, RESUME_GID, true);
    } catch (err) {
      return interaction.editReply(`❌ Could not load resume sheet: ${err.message}`);
    }

    const allRows = parseResumeRows(resumeRows);
    if (!allRows.length) return interaction.editReply('❌ Resume sheet returned no rows.');

    // Group by coach name
    const byCoach = new Map();
    for (const r of allRows) {
      if (!byCoach.has(r.coach)) byCoach.set(r.coach, []);
      byCoach.get(r.coach).push(r);
    }

    let allRuns = [];
    for (const [coach, rows] of byCoach) {
      allRuns.push(...buildDynastyRunsForCoach(coach, rows));
    }

    // Filter
    allRuns = allRuns.filter((s) => s.years >= minYears);
    if (coachArg) {
      const q = normalize(coachArg);
      allRuns = allRuns.filter((s) => {
        const cn = normalize(s.coach);
        return cn === q || (q.length >= 3 && cn.includes(q));
      });
    }

    if (!allRuns.length) {
      return interaction.editReply(
        coachArg
          ? `❌ No dynasties of ${minYears}+ seasons found for **${coachArg}**.`
          : `❌ No dynasties of ${minYears}+ seasons found.`
      );
    }

    // Sort: longest first, then highest win pct
    allRuns.sort((a, b) => {
      if (b.years !== a.years) return b.years - a.years;
      const apct = a.wins + a.losses > 0 ? a.wins / (a.wins + a.losses) : 0;
      const bpct = b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : 0;
      return bpct - apct;
    });

    const top = allRuns.slice(0, 25);

    const lines = top.map((s, i) => {
      const yrs   = s.startYear === s.endYear ? s.startYear : `${s.startYear}–${s.endYear}`;
      const games = s.wins + s.losses;
      const pct   = games > 0 ? (s.wins / games).toFixed(3) : '—';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      return `${medal} **${s.coach}** @ ${s.team} — ${s.years} yrs (${yrs}) — **${s.wins}-${s.losses}** (${pct})`;
    });

    const chunkSize = 12;
    const chunks = [];
    for (let i = 0; i < lines.length; i += chunkSize) chunks.push(lines.slice(i, i + chunkSize));

    const embeds = chunks.map((chunk, i) =>
      new EmbedBuilder()
        .setTitle(
          i === 0
            ? `🏛️ Dynasty Tracker — ${minYears}+ year tenures (${allRuns.length} qualifying)`
            : '🏛️ Dynasty Tracker — continued'
        )
        .setColor(0x16a085)
        .setDescription(chunk.join('\n'))
        .setFooter({ text: 'Consecutive seasons at one program • Resume sheet' })
    );

    return interaction.editReply({ embeds: embeds.slice(0, 10) });
  },
};
