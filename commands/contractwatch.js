// ============================================================
//  commands/contractwatch.js  —  CSV source of truth
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData, getCurrentSeason, getTeamName,
  getLatestTeamSeason, getLatestTeamStats,
  getConferenceName, getConferenceAbbrevFromName, safeNumber,
} = require('../utils/data');
const { fetchSheetCsv, normalize } = require('../utils/sheets');

const COACH_SHEET_ID  = process.env.NZCFL_COACH_SHEET_ID  || '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';
const COACH_SHEET_TAB = process.env.NZCFL_COACH_SHEET_TAB || 'Coach';
const VALUE_SHEET_ID  = process.env.NZCFL_VALUE_SHEET_ID  || '1mbgob2h--4tRkpgUCY3u4KWAUjuuTo_-mwfZD52y1GY';
const VALUE_SHEET_GID = process.env.NZCFL_VALUE_SHEET_GID || '604303336';
const RANKS_SHEET_ID  = process.env.NZCFL_RECRUITING_RANKS_SHEET_ID   || '1VWzSOnixaQlJBQOw6zAyKdfo_XFhPuTFKO_5noKQEq4';
const RANKS_SHEET_NAME = process.env.NZCFL_RECRUITING_RANKS_SHEET_NAME || '247';

const POWER_CONFS = new Set(['ACC','B1G','B12','P12','SEC']);

function parseCoachSheet(rows) {
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    if (rows[i].some(c => c.toLowerCase().includes('coach') && c.toLowerCase() !== 'coach rankings')) {
      hi = i; break;
    }
  }
  if (hi === -1) hi = 1;

  const active = [], vacant = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r     = rows[i];
    const coach = (r[0] || '').trim();
    const team  = (r[1] || '').trim();
    if (!team) continue;
    const ni = (idx, def = 0) => { const v = parseInt(r[idx]); return isNaN(v) ? def : v; };
    if (coach) {
      active.push({ coach, team, contractYrs: ni(9) });
    } else {
      vacant.push({ team });
    }
  }
  return { active, vacant };
}

function safeNum(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

function parseValueMap(rows) {
  const map = new Map();
  if (!rows.length) return map;
  let hi = rows.findIndex(r => r.some(c => ['team','school'].includes(c.toLowerCase().trim())));
  if (hi < 0) hi = 0;
  const h       = rows[hi].map(c => c.toLowerCase().trim());
  const teamCol = h.findIndex(x => x === 'team' || x === 'school');
  const valCol  = h.findIndex(x => x.includes('value') || x.includes('score') || x.includes('val'));
  const rankCol = h.findIndex(x => x === 'rank' || x === '#' || x === 'rk');
  if (teamCol < 0) return map;
  rows.slice(hi + 1).forEach((r, idx) => {
    const t = (r[teamCol] || '').trim(); if (!t) return;
    map.set(normalize(t), { rank: rankCol >= 0 && safeNum(r[rankCol]) ? safeNum(r[rankCol]) : idx + 1, value: valCol >= 0 ? safeNum(r[valCol]) : 0 });
  });
  return map;
}

function parseRecMap(rows) {
  const map = new Map();
  for (const r of rows) {
    const rank = safeNum(r[0]), school = (r[1] || '').trim();
    if (!rank || !school || normalize(school) === 'school') continue;
    map.set(normalize(school), rank);
  }
  return map;
}

function lookupTeam(map, teamName) {
  const n = normalize(teamName);
  if (map.has(n)) return map.get(n);
  // Simple alias fallback
  const ALIAS = { ohiostate:'tosu', tosu:'ohiostate', northcarolina:'unc', unc:'northcarolina' };
  const alt = ALIAS[n]; if (alt && map.has(alt)) return map.get(alt);
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('contractwatch')
    .setDescription('Expiring contracts and top open coaching jobs')
    .addStringOption(opt =>
      opt.setName('view').setDescription('What to show (default: both)').setRequired(false)
        .addChoices(
          { name: 'Both',               value: 'both'     },
          { name: 'Expiring contracts', value: 'expiring' },
          { name: 'Top open jobs',      value: 'openings' },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData    = getLatestLeagueData();
    const currentSeason = leagueData ? getCurrentSeason(leagueData) : '?';
    const view          = interaction.options.getString('view') || 'both';

    let coachRows, valueRows, recRows;
    try {
      [coachRows, valueRows, recRows] = await Promise.all([
        fetchSheetCsv(COACH_SHEET_ID, COACH_SHEET_TAB),
        fetchSheetCsv(VALUE_SHEET_ID, VALUE_SHEET_GID, true).catch(() => []),
        fetchSheetCsv(RANKS_SHEET_ID, RANKS_SHEET_NAME).catch(() => []),
      ]);
    } catch (err) {
      return interaction.editReply(`❌ Could not load data: ${err.message}`);
    }

    const { active, vacant } = parseCoachSheet(coachRows);
    const valueMap = parseValueMap(valueRows);
    const recMap   = parseRecMap(recRows);
    const embeds   = [];

    // ── Expiring contracts (contractYrs === 0) ─────────────
    if (view === 'both' || view === 'expiring') {
      const expiring = active
        .filter(c => c.contractYrs <= 1)
        .sort((a, b) => a.coach.localeCompare(b.coach));

      if (expiring.length) {
        const lines = expiring.map(c => `**${c.coach}** — ${c.team}`);
        embeds.push(new EmbedBuilder()
          .setTitle(`Expiring Contracts`)
          .setColor(0xe67e22)
          .setDescription(lines.join('\n'))
          .setFooter({ text: 'Coaches whose contracts expire after this season' })
          .setTimestamp()
        );
      } else if (view === 'expiring') {
        return interaction.editReply('No contracts expiring after this season.');
      }
    }

    // ── Top 10 open jobs ───────────────────────────────────
    if (view === 'both' || view === 'openings') {
      const scored = vacant.map(v => {
        const vi  = lookupTeam(valueMap, v.team);
        const rec = lookupTeam(recMap,   v.team);

        let confAbbrev = '?', wins = 0, losses = 0;
        if (leagueData?.teams) {
          const lt = leagueData.teams.find(t => !t.disabled && (
            normalize(getTeamName(t)) === normalize(v.team) ||
            normalize(t.region)       === normalize(v.team) ||
            normalize(t.abbrev)       === normalize(v.team)
          ));
          if (lt) {
            confAbbrev = getConferenceAbbrevFromName(getConferenceName(leagueData, lt.cid));
            const seas = getLatestTeamSeason(lt, getCurrentSeason(leagueData));
            wins   = safeNumber(seas?.won,  0);
            losses = safeNumber(seas?.lost, 0);
          }
        }

        let score = 0;
        if (vi?.rank)  score += Math.max(0, 50 - (vi.rank / 2.4));
        if (wins + losses > 0) score += (wins / (wins + losses)) * 20;
        if (rec)       score += Math.max(0, 20 - (rec / 6));
        if (POWER_CONFS.has(confAbbrev)) score += 15;

        const record = wins + losses > 0 ? `${wins}-${losses}` : 'N/A';
        return { ...v, confAbbrev, record, valueRank: vi?.rank ?? null, recRank: rec, score };
      }).sort((a, b) => b.score - a.score).slice(0, 10);

      if (scored.length) {
        const lines = scored.map((j, idx) => {
          const power  = POWER_CONFS.has(j.confAbbrev) ? '* ' : '  ';
          const valStr = j.valueRank ? ` · Val #${j.valueRank}` : '';
          const recStr = j.recRank   ? ` · Rec #${j.recRank}`   : '';
          return (
            `\`${String(idx+1).padStart(2)}.\`${power}**${j.team}**\n` +
            `      ${j.confAbbrev} · ${j.record}${valStr}${recStr}`
          );
        });

        embeds.push(new EmbedBuilder()
          .setTitle(`Top Open Coaching Jobs`)
          .setColor(0x3498db)
          .setDescription(lines.join('\n\n'))
          .setFooter({ text: `${vacant.length} vacant schools · * = Power 5` })
          .setTimestamp()
        );
      } else if (view === 'openings') {
        return interaction.editReply('No vacant coaching positions found.');
      }
    }

    if (!embeds.length) return interaction.editReply('Nothing to show.');
    return interaction.editReply({ embeds: embeds.slice(0, 10) });
  },
};