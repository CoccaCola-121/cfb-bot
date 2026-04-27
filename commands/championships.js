// ============================================================
//  commands/championships.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getCurrentSeason,
  getTeamName,
  getConferenceName,
  getDivisionName,
  safeNumber,
} = require('../utils/data');
const { normalize } = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');

const SHEET_ID =
  process.env.NZCFL_INFO_SHEET_ID ||
  process.env.NZCFL_COACH_SHEET_ID ||
  process.env.GOOGLE_SHEET_ID ||
  '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';

const RESUME_TAB = process.env.NZCFL_RESUME_SHEET_TAB || 'Resume';

const MAX_NAT_TITLES_DISPLAY = 15;
const MAX_FIELDS = 25;
const MAX_EMBED_CHARS = 5800;

function seasonYear(s) {
  return Number(s?.season);
}

function teamSeasonRows(leagueData) {
  const rows = [];

  for (const team of leagueData?.teams || []) {
    if (team.disabled) continue;

    for (const s of team.seasons || []) {
      const year = seasonYear(s);
      if (!Number.isFinite(year)) continue;

      rows.push({
        team,
        season: s,
        year,
        tid: team.tid,
        teamName: getTeamName(team),
        cid: s.cid ?? team.cid,
        did: s.did ?? team.did,
        won: safeNumber(s.won),
        lost: safeNumber(s.lost),
        tied: safeNumber(s.tied),
        wonConf: safeNumber(s.wonConf),
        lostConf: safeNumber(s.lostConf),
        tiedConf: safeNumber(s.tiedConf),
        wonDiv: safeNumber(s.wonDiv),
        lostDiv: safeNumber(s.lostDiv),
        tiedDiv: safeNumber(s.tiedDiv),
        playoffRoundsWon: safeNumber(s.playoffRoundsWon),
      });
    }
  }

  return rows;
}

function pct(w, l, t = 0) {
  const g = w + l + t;
  return g > 0 ? w / g : 0;
}

function compareWinner(a, b, scope) {
  const aPct = scope === 'division'
    ? pct(a.wonDiv, a.lostDiv, a.tiedDiv)
    : pct(a.wonConf, a.lostConf, a.tiedConf);

  const bPct = scope === 'division'
    ? pct(b.wonDiv, b.lostDiv, b.tiedDiv)
    : pct(b.wonConf, b.lostConf, b.tiedConf);

  if (bPct !== aPct) return bPct - aPct;
  if (b.playoffRoundsWon !== a.playoffRoundsWon) return b.playoffRoundsWon - a.playoffRoundsWon;
  if (b.won !== a.won) return b.won - a.won;
  if (a.lost !== b.lost) return a.lost - b.lost;
  return a.teamName.localeCompare(b.teamName);
}

function teamOnlyLine(row) {
  return row.teamName;
}

function getConferenceAbbrev(leagueData, cid) {
  const rawName = String(getConferenceName(leagueData, cid) || '').trim();
  const norm = normalize(rawName);

  if (norm.includes('big ten')) return 'B1G';
  if (norm.includes('big 12') || norm.includes('big twelve')) return 'B12';
  if (norm.includes('conference usa') || norm.includes('c usa') || norm.includes('cu usa')) return 'C-USA';
  if (norm.includes('pacific coast') || norm.includes('pac 12') || norm.includes('pac twelve')) return 'P12';
  if (norm.includes('southeastern') || norm === 'sec' || norm.includes('south eastern')) return 'SEC';
  if (norm.includes('mountain west')) return 'MW';
  if (norm.includes('american athletic')) return 'AAC';
  if (norm.includes('atlantic coast')) return 'ACC';
  if (norm.includes('mid american')) return 'MAC';
  if (norm.includes('sun belt')) return 'SBC';

  const conf = (leagueData.confs || leagueData.conferences || []).find((c) => c.cid === cid);
  const rawAbbrev = String(conf?.abbrev || conf?.abbr || conf?.shortName || '').trim();

  const overrides = {
    BTC: 'B1G',
    'CU USA': 'C-USA',
    CUSA: 'C-USA',
    PCC: 'P12',
    SC: 'SEC',
    MWC: 'MW',
  };

  if (overrides[rawAbbrev]) return overrides[rawAbbrev];

  return rawAbbrev || rawName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function parseResumeRows(rows) {
  let hi = -1;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map((c) => String(c || '').toLowerCase().trim());
    if (r.includes('coach') && r.includes('total')) {
      hi = i;
      break;
    }
  }

  if (hi === -1) return [];

  const header = rows[hi].map((c) => String(c || '').trim());
  const coachCol = header.findIndex((h) => h.toLowerCase() === 'coach');
  if (coachCol === -1) return [];

  const yearIdxs = header
    .map((h, i) => (/^\d{4}$/.test(h) ? i : -1))
    .filter((i) => i >= 0);

  const seen = new Set();
  let splitAt = -1;

  for (let i = 0; i < yearIdxs.length; i++) {
    const y = header[yearIdxs[i]];
    if (seen.has(y)) {
      splitAt = i;
      break;
    }
    seen.add(y);
  }

  const recordYearCols = splitAt >= 0 ? yearIdxs.slice(0, splitAt) : yearIdxs;
  const teamYearCols = splitAt >= 0 ? yearIdxs.slice(splitAt) : [];

  const out = [];

  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const coach = String(r[coachCol] || '').trim();
    if (!coach) continue;

    const recordByYear = new Map();
    for (const col of recordYearCols) {
      const y = header[col];
      const v = String(r[col] || '').trim();
      if (v && /^\d{1,2}-\d{1,2}$/.test(v)) recordByYear.set(y, v);
    }

    const teamByYear = new Map();
    for (const col of teamYearCols) {
      const y = header[col];
      const v = String(r[col] || '').trim();
      if (v) teamByYear.set(y, v);
    }

    const allYears = [...new Set([...recordByYear.keys(), ...teamByYear.keys()])];

    for (const y of allYears) {
      const rec = recordByYear.get(y);
      const team = teamByYear.get(y);
      const m = rec ? rec.match(/^(\d+)-(\d+)$/) : null;

      out.push({
        year: Number(y),
        coach,
        team: team || null,
        wins: m ? +m[1] : 0,
        losses: m ? +m[2] : 0,
      });
    }
  }

  return out;
}

async function getResumeRows() {
  try {
    const rows = await fetchSheetCsv(SHEET_ID, RESUME_TAB);
    return parseResumeRows(rows);
  } catch {
    return [];
  }
}

function coachForYearTeam(resumeRows, year, teamName) {
  const targetTeam = normalize(teamName);

  const exact = resumeRows.find((r) =>
    Number(r.year) === Number(year) &&
    r.team &&
    normalize(r.team) === targetTeam
  );

  if (exact) return exact.coach;

  const fuzzy = resumeRows.find((r) => {
    if (Number(r.year) !== Number(year) || !r.team) return false;

    const rt = normalize(r.team);
    return rt === targetTeam || rt.includes(targetTeam) || targetTeam.includes(rt);
  });

  return fuzzy?.coach || 'Unknown Coach';
}

function buildNatChamps(leagueData, resumeRows, currentSeason, coachFilter = null) {
  const rows = teamSeasonRows(leagueData).filter((r) => r.year < currentSeason);
  const byYear = new Map();

  for (const r of rows) {
    if (!byYear.has(r.year)) byYear.set(r.year, []);
    byYear.get(r.year).push(r);
  }

  const champs = [];

  for (const [year, teams] of byYear.entries()) {
    const maxRounds = Math.max(...teams.map((t) => t.playoffRoundsWon));
    if (maxRounds <= 0) continue;

    const champ = teams
      .filter((t) => t.playoffRoundsWon === maxRounds)
      .sort((a, b) => compareWinner(a, b, 'conference'))[0];

    const coach = coachForYearTeam(resumeRows, year, champ.teamName);

    champs.push({
      year,
      teamName: champ.teamName,
      coach,
      line: `**${year}** — ${champ.teamName} (${coach})`,
    });
  }

  let out = champs.sort((a, b) => b.year - a.year);

  if (coachFilter) {
    const q = normalize(coachFilter);
    out = out.filter((c) => {
      const cn = normalize(c.coach);
      return cn === q || cn.includes(q) || q.includes(cn);
    });
  }

  return out;
}

function buildGroupWinners(leagueData, scope, targetYear = null) {
  const rows = teamSeasonRows(leagueData).filter((r) => {
    if (targetYear !== null && r.year !== targetYear) return false;
    return scope === 'division' ? r.did !== undefined && r.did !== null : r.cid !== undefined && r.cid !== null;
  });

  const groups = new Map();

  for (const r of rows) {
    const key = scope === 'division' ? `${r.year}|${r.did}` : `${r.year}|${r.cid}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const winners = [];

  for (const teams of groups.values()) {
    const winner = [...teams].sort((a, b) => compareWinner(a, b, scope))[0];

    if (scope === 'division') {
      const confAbbrev = getConferenceAbbrev(leagueData, winner.cid);
      const divName = getDivisionName(leagueData, winner.did);
      const groupName = `${confAbbrev} ${divName}`;

      winners.push({
        year: winner.year,
        groupId: winner.did,
        groupName,
        winner,
        line: `**${winner.year}** — ${groupName}: ${teamOnlyLine(winner)}`,
      });
    } else {
      const groupName = getConferenceName(leagueData, winner.cid);

      winners.push({
        year: winner.year,
        groupId: winner.cid,
        groupName,
        winner,
        line: `**${winner.year}** — ${groupName}: ${teamOnlyLine(winner)}`,
      });
    }
  }

  return winners.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return String(a.groupName).localeCompare(String(b.groupName));
  });
}

function makeDescription(lines, limit = 80) {
  const kept = [];
  let chars = 0;

  for (const line of lines) {
    const next = chars + line.length + 1;
    if (kept.length >= limit || next > MAX_EMBED_CHARS) break;
    kept.push(line);
    chars = next;
  }

  const remaining = lines.length - kept.length;
  if (remaining > 0) kept.push(`\n…and ${remaining} more`);

  return kept.join('\n') || 'No results found.';
}

function makeFieldsFromGrouped(titleedGroups) {
  const fields = [];
  let usedChars = 0;
  let remaining = 0;

  for (const group of titleedGroups) {
    const value = group.lines.join('\n') || 'None';
    const fieldChars = group.name.length + value.length;

    if (fields.length >= MAX_FIELDS || usedChars + fieldChars > MAX_EMBED_CHARS) {
      remaining += group.lines.length;
      continue;
    }

    fields.push({
      name: group.name.slice(0, 256),
      value: value.slice(0, 1024),
      inline: false,
    });
    usedChars += fieldChars;
  }

  return { fields, remaining };
}

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'coach') return interaction.respond([]);

  const resumeRows = await getResumeRows();
  const q = normalize(focused.value);

  const coaches = [...new Set(resumeRows.map((r) => r.coach).filter(Boolean))]
    .filter((c) => !q || normalize(c).includes(q))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 25)
    .map((c) => ({ name: c, value: c }));

  return interaction.respond(coaches);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('championships')
    .setDescription('Show national, conference, and division championship history')
    .addStringOption((opt) =>
      opt
        .setName('view')
        .setDescription('Championship view')
        .addChoices(
          { name: 'National champions', value: 'natchamps' },
          { name: 'Conference champions', value: 'conference' },
          { name: 'Division champions', value: 'division' },
        )
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('year')
        .setDescription('Season year')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('coach')
        .setDescription('Filter national titles by coach')
        .setAutocomplete(true)
        .setRequired(false)
    ),

  autocomplete,

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) return interaction.editReply('❌ No league data loaded.');

    const view = interaction.options.getString('view');
    const year = interaction.options.getInteger('year');
    const coach = interaction.options.getString('coach');
    const resumeRows = await getResumeRows();

    const currentSeason = Number(getCurrentSeason(leagueData));
    const targetYear = Number.isFinite(year) ? year : null;

    if (targetYear !== null && !view && !coach) {
      const conf = buildGroupWinners(leagueData, 'conference', targetYear);
      const div = buildGroupWinners(leagueData, 'division', targetYear);

      const groups = [
        {
          name: 'Conference Champions',
          lines: conf.map((x) => `**${x.groupName}** — ${teamOnlyLine(x.winner)}`),
        },
        {
          name: 'Division Champions',
          lines: div.map((x) => `**${x.groupName}** — ${teamOnlyLine(x.winner)}`),
        },
      ];

      const { fields, remaining } = makeFieldsFromGrouped(groups);

      const embed = new EmbedBuilder()
        .setTitle(`Championships — ${targetYear}`)
        .setColor(0xf1c40f)
        .addFields(fields)
        .setFooter({
          text: remaining > 0 ? `…and ${remaining} more` : 'Conference and division winners',
        })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (!view || view === 'natchamps' || coach) {
      const champs = buildNatChamps(leagueData, resumeRows, currentSeason, coach);

      if (!champs.length) {
        return interaction.editReply(
          coach
            ? `❌ No national titles found for **${coach}**.`
            : '❌ No national champions found.'
        );
      }

      const display = champs.slice(0, MAX_NAT_TITLES_DISPLAY);
      const hidden = champs.length - display.length;

      const embed = new EmbedBuilder()
        .setTitle(coach ? `National Champions — ${coach}` : 'National Champions')
        .setColor(0xf1c40f)
        .setDescription(display.map((c) => c.line).join('\n'))
        .setFooter({
          text:
            hidden > 0
              ? `Showing ${display.length} of ${champs.length} completed title seasons • Current season ${currentSeason} excluded`
              : `${champs.length} completed title season${champs.length === 1 ? '' : 's'} • Current season ${currentSeason} excluded`,
        })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (view === 'conference' || view === 'division') {
      const winners = buildGroupWinners(leagueData, view, targetYear);

      if (!winners.length) {
        return interaction.editReply(`❌ No ${view} winners found${targetYear ? ` for **${targetYear}**` : ''}.`);
      }

      const title = targetYear
        ? `${view === 'conference' ? 'Conference' : 'Division'} Champions — ${targetYear}`
        : `${view === 'conference' ? 'Conference' : 'Division'} Champions`;

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(view === 'conference' ? 0x9b59b6 : 0x3498db)
        .setDescription(makeDescription(winners.map((w) => w.line)))
        .setFooter({
          text: targetYear
            ? `${winners.length} winner${winners.length === 1 ? '' : 's'}`
            : `Newest first${Number.isFinite(currentSeason) ? ` • Current season ${currentSeason}` : ''}`,
        })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    return interaction.editReply('❌ Unknown championships view.');
  },
};