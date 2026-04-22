// ============================================================
//  commands/openpositions.js  —  Top coaching jobs ranked by
//  (weighted) team value + current-season record, with an
//  optional conference filter and a Current / End-of-Season view.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData, getCurrentSeason, getTeamName,
  getLatestTeamSeason,
  getConferenceName, getConferenceAbbrevFromName, safeNumber,
} = require('../utils/data');
const { fetchSheetCsv, normalize } = require('../utils/sheets');

const COACH_SHEET_ID  = process.env.NZCFL_COACH_SHEET_ID  || '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';
const COACH_SHEET_TAB = process.env.NZCFL_COACH_SHEET_TAB || 'Coach';
const VALUE_SHEET_ID  = process.env.NZCFL_VALUE_SHEET_ID  || '1mbgob2h--4tRkpgUCY3u4KWAUjuuTo_-mwfZD52y1GY';
const VALUE_SHEET_GID = process.env.NZCFL_VALUE_SHEET_GID || '604303336';

const POWER_CONFS = new Set(['ACC','B1G','B12','P12','SEC']);

// Scoring weights — the user asked for value to carry significantly more
// weight than current-season record.
const VALUE_WEIGHT  = 0.70;
const RECORD_WEIGHT = 0.30;
// A small bump so a P5 job outranks a comparably-valued non-P5 job.
const P5_BONUS      = 5;

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

// Parse the Value sheet. Returns { map, totalRanked }.
function parseValueMap(rows) {
  const map = new Map();
  if (!rows.length) return { map, totalRanked: 0 };
  let hi = rows.findIndex(r => r.some(c => ['team','school'].includes(c.toLowerCase().trim())));
  if (hi < 0) hi = 0;
  const h       = rows[hi].map(c => c.toLowerCase().trim());
  const teamCol = h.findIndex(x => x === 'team' || x === 'school');
  const valCol  = h.findIndex(x => x.includes('value') || x.includes('score') || x.includes('val'));
  const rankCol = h.findIndex(x => x === 'rank' || x === '#' || x === 'rk');
  if (teamCol < 0) return { map, totalRanked: 0 };

  let count = 0;
  rows.slice(hi + 1).forEach((r, idx) => {
    const t = (r[teamCol] || '').trim(); if (!t) return;
    const rank = rankCol >= 0 && safeNum(r[rankCol]) ? safeNum(r[rankCol]) : idx + 1;
    const value = valCol >= 0 ? safeNum(r[valCol]) : 0;
    map.set(normalize(t), { rank, value });
    count += 1;
  });
  return { map, totalRanked: count };
}

function lookupTeam(map, teamName) {
  const n = normalize(teamName);
  if (map.has(n)) return map.get(n);
  const ALIAS = { ohiostate:'tosu', tosu:'ohiostate', northcarolina:'unc', unc:'northcarolina' };
  const alt = ALIAS[n]; if (alt && map.has(alt)) return map.get(alt);
  return null;
}

// Map an int rank (1 = best) to a 0..100 score where 1 → ~100 and last → 0.
function rankToScore(rank, totalRanked) {
  if (!rank || !totalRanked || totalRanked <= 1) return 0;
  const pct = (totalRanked - rank) / (totalRanked - 1);
  return Math.max(0, Math.min(1, pct)) * 100;
}

function scoreJob(job, leagueData, valueMap, totalRanked) {
  const vi = lookupTeam(valueMap, job.team);

  let confAbbrev = '?', wins = 0, losses = 0, ties = 0;
  if (leagueData?.teams) {
    const lt = leagueData.teams.find(t => !t.disabled && (
      normalize(getTeamName(t)) === normalize(job.team) ||
      normalize(t.region)       === normalize(job.team) ||
      normalize(t.abbrev)       === normalize(job.team)
    ));
    if (lt) {
      confAbbrev = getConferenceAbbrevFromName(getConferenceName(leagueData, lt.cid));
      const seas = getLatestTeamSeason(lt, getCurrentSeason(leagueData));
      wins   = safeNumber(seas?.won,  0);
      losses = safeNumber(seas?.lost, 0);
      ties   = safeNumber(seas?.tied, 0);
    }
  }

  // Value: lower rank = better → use rankToScore. Teams with no value entry
  // default to 0 so they don't benefit from the valuable slot.
  const valueScore = vi?.rank ? rankToScore(vi.rank, totalRanked) : 0;

  // Record: win% across games played so far; ties count as half a win.
  const gamesPlayed = wins + losses + ties;
  const recordScore = gamesPlayed > 0
    ? ((wins + ties * 0.5) / gamesPlayed) * 100
    : 0;

  let score = valueScore * VALUE_WEIGHT + recordScore * RECORD_WEIGHT;
  if (POWER_CONFS.has(confAbbrev)) score += P5_BONUS;

  const record = gamesPlayed > 0 ? `${wins}-${losses}${ties ? `-${ties}` : ''}` : 'N/A';
  return {
    ...job,
    confAbbrev,
    record,
    valueRank: vi?.rank ?? null,
    score,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('openpositions')
    .setDescription('Top open coaching jobs ranked by team value + current-season record')
    .addStringOption(opt =>
      opt.setName('view')
        .setDescription('Current vacancies only, or include end-of-season openings')
        .setRequired(false)
        .addChoices(
          { name: 'Current',        value: 'current'        },
          { name: 'End of Season',  value: 'end_of_season'  },
        )
    )
    .addStringOption(opt =>
      opt.setName('conference')
        .setDescription('Filter to a specific conference (optional)')
        .setRequired(false)
        .addChoices(
          { name: 'ACC',   value: 'ACC'   },
          { name: 'B1G',   value: 'B1G'   },
          { name: 'B12',   value: 'B12'   },
          { name: 'P12',   value: 'P12'   },
          { name: 'SEC',   value: 'SEC'   },
          { name: 'MW',    value: 'MW'    },
          { name: 'MAC',   value: 'MAC'   },
          { name: 'C-USA', value: 'C-USA' },
          { name: 'AAC',   value: 'AAC'   },
          { name: 'SUN',   value: 'SUN'   },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    const view       = interaction.options.getString('view') || 'current';
    const confFilter = interaction.options.getString('conference') || null;

    let coachRows, valueRows;
    try {
      [coachRows, valueRows] = await Promise.all([
        fetchSheetCsv(COACH_SHEET_ID, COACH_SHEET_TAB),
        fetchSheetCsv(VALUE_SHEET_ID, VALUE_SHEET_GID, true).catch(() => []),
      ]);
    } catch (err) {
      return interaction.editReply(`❌ Could not load data: ${err.message}`);
    }

    const { active, vacant } = parseCoachSheet(coachRows);
    const { map: valueMap, totalRanked } = parseValueMap(valueRows);

    // Always include currently vacant schools.
    const jobs = vacant.map(v => ({ team: v.team, source: 'open', coach: null }));

    if (view === 'end_of_season') {
      const expiring = active.filter(c => c.contractYrs <= 1);
      for (const c of expiring) {
        jobs.push({ team: c.team, source: 'expiring', coach: c.coach });
      }
    }

    if (!jobs.length) {
      const msg = view === 'end_of_season'
        ? 'No current vacancies and no contracts set to expire after this season.'
        : 'No vacant coaching positions found.';
      return interaction.editReply(msg);
    }

    let scored = jobs
      .map(j => scoreJob(j, leagueData, valueMap, totalRanked))
      .sort((a, b) => b.score - a.score);

    if (confFilter) {
      scored = scored.filter(j => j.confAbbrev === confFilter);
      if (!scored.length) {
        return interaction.editReply(
          `No matching jobs in **${confFilter}** for view **${view}**.`
        );
      }
    }

    scored = scored.slice(0, 10);

    const lines = scored.map((j, idx) => {
      const power  = POWER_CONFS.has(j.confAbbrev) ? '* ' : '  ';
      const valStr = j.valueRank ? ` · Val #${j.valueRank}` : '';

      let status = '';
      if (j.source === 'expiring') {
        status = ` · ⏳ Expiring (${j.coach})`;
      }

      return (
        `\`${String(idx + 1).padStart(2)}.\`${power}**${j.team}**\n` +
        `      ${j.confAbbrev} · ${j.record}${valStr}${status}`
      );
    });

    const viewLabel = view === 'end_of_season' ? 'End of Season' : 'Current';
    const title = confFilter
      ? `Top Open Coaching Jobs — ${viewLabel} (${confFilter})`
      : `Top Open Coaching Jobs — ${viewLabel}`;

    const expiringCount = jobs.filter(j => j.source === 'expiring').length;
    const footerParts = [`${vacant.length} currently vacant`];
    if (view === 'end_of_season') {
      footerParts.push(`${expiringCount} expiring after this season`);
    }
    footerParts.push(
      `Score = Value × ${Math.round(VALUE_WEIGHT * 100)}% + Record × ${Math.round(RECORD_WEIGHT * 100)}%  ·  * = Power 5`
    );

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0x3498db)
      .setDescription(lines.join('\n\n'))
      .setFooter({ text: footerParts.join(' · ') })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
