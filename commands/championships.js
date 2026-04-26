// ============================================================
//  commands/championships.js
//
//  Two views, controlled by `view`:
//
//    natchamps   (default) — full national-title roll call from
//                NAT_TITLE_ENTRIES, newest-first, paged into
//                multiple embeds if needed.
//
//    confleaders — leaderboard of conference titles per coach,
//                  pulled from the live Coach sheet.
//
//  Optional `coach` filter narrows the roll call to a single coach.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { normalize } = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');
const { NAT_TITLE_ENTRIES, NAT_TITLE_ASTERISK } = require('../utils/natTitles');

const COACH_SHEET_ID  = process.env.NZCFL_COACH_SHEET_ID  || '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';
const COACH_SHEET_TAB = process.env.NZCFL_COACH_SHEET_TAB || 'Coach';

// ── Reuse the same parser shape as coachstats / coachleaderboard ─
function parseCoachCsv(rows) {
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    if (rows[i].some((c) => c.toLowerCase().includes('coach') && c.toLowerCase() !== 'coach rankings')) {
      hi = i; break;
    }
  }
  if (hi === -1) hi = 1;

  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const coach = (r[0] || '').trim();
    const team  = (r[1] || '').trim();
    if (!coach || !team) continue;

    const ni = (idx) => {
      const v = parseFloat(r[idx]);
      return isNaN(v) ? 0 : Math.round(v);
    };

    out.push({
      coach,
      team,
      confTitles: ni(12),
      natTitles:  ni(14),
      years:      ni(4),
    });
  }
  return out;
}

// Group nat-title entries by primary alias (first alias in list).
// Multiple coaches can share an alias bucket if they're close enough.
function groupByPrimary(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = (e.aliases[0] || '').toLowerCase().replace(/^@/, '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e.year);
  }
  return groups;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('championships')
    .setDescription('Show national-title history or conference-title leaders')
    .addStringOption((opt) =>
      opt
        .setName('view')
        .setDescription('Which leaderboard to show')
        .addChoices(
          { name: 'National titles by year', value: 'natchamps' },
          { name: 'Conference title leaders', value: 'confleaders' }
        )
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('coach')
        .setDescription('Filter natchamps to one coach (alias-matched)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const view  = interaction.options.getString('view') || 'natchamps';
    const coach = interaction.options.getString('coach');

    if (view === 'natchamps') {
      let entries = [...NAT_TITLE_ENTRIES].sort((a, b) => +b.year - +a.year);

      if (coach) {
        const q = normalize(coach);
        entries = entries.filter((e) =>
          e.aliases.some((a) => {
            const an = normalize(a);
            return (
              an === q ||
              (an.length >= 4 && q.includes(an)) ||
              (q.length >= 4 && an.includes(q))
            );
          })
        );
        if (entries.length === 0) {
          return interaction.editReply(`❌ No national titles found for **${coach}**.`);
        }
      }

      // Per-coach grouped count for the title bar
      const grouped = groupByPrimary(NAT_TITLE_ENTRIES);
      const totalCoaches = grouped.size;

      const lines = entries.map((e) => {
        const display = (e.aliases[0] || '?').replace(/^@/, '');
        const star    = NAT_TITLE_ASTERISK.has(display) || NAT_TITLE_ASTERISK.has(display.toUpperCase()) ? '*' : '';
        return `**${e.year}** — ${display}${star}`;
      });

      // Page into chunks of 25
      const chunkSize = 25;
      const chunks = [];
      for (let i = 0; i < lines.length; i += chunkSize) chunks.push(lines.slice(i, i + chunkSize));

      const embeds = chunks.map((chunk, i) =>
        new EmbedBuilder()
          .setTitle(
            i === 0
              ? coach
                ? `🏆 National Titles — ${coach}`
                : `🏆 National Titles (${entries.length} total • ${totalCoaches} unique coaches)`
              : '🏆 National Titles — continued'
          )
          .setColor(0xf1c40f)
          .setDescription(chunk.join('\n'))
          .setFooter({
            text: NAT_TITLE_ASTERISK.size > 0 ? '* Disputed title — see league records' : 'NZCFL national title history',
          })
      );

      return interaction.editReply({ embeds: embeds.slice(0, 10) });
    }

    // ── Conference title leaders ───────────────────────────────
    let csvRows;
    try {
      csvRows = await fetchSheetCsv(COACH_SHEET_ID, COACH_SHEET_TAB);
    } catch (err) {
      return interaction.editReply(`❌ Could not load coach sheet: ${err.message}`);
    }

    const all = parseCoachCsv(csvRows);
    const sorted = all
      .filter((c) => c.confTitles > 0)
      .sort((a, b) => b.confTitles - a.confTitles || b.natTitles - a.natTitles || b.years - a.years)
      .slice(0, 25);

    if (!sorted.length) {
      return interaction.editReply('❌ No conference titles found in the coach sheet.');
    }

    const lines = sorted.map((c, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      const nat = c.natTitles > 0 ? ` • 🏆 ${c.natTitles}` : '';
      return `${medal} **${c.coach}** (${c.team}) — **${c.confTitles}** conf titles${nat}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('🥇 Conference Title Leaders')
      .setColor(0x9b59b6)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Active coaches • Top 25 by conf titles' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
