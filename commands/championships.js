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
const { NAT_TITLE_ENTRIES } = require('../utils/natTitles');

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
  const aPct =
    scope === 'division'
      ? pct(a.wonDiv, a.lostDiv, a.tiedDiv)
      : pct(a.wonConf, a.lostConf, a.tiedConf);

  const bPct =
    scope === 'division'
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
  const norm = normalize(rawName).replace(/[^a-z0-9]/g, '');

  if (norm.includes('bigten')) return 'B1G';
  if (norm.includes('big12') || norm.includes('bigtwelve')) return 'B12';
  if (norm.includes('conferenceusa') || norm.includes('cusa') || norm.includes('cuusa')) return 'C-USA';
  if (norm.includes('pac12') || norm.includes('pactwelve') || norm.includes('pacificcoast') || norm.includes('pcc')) return 'P12';
  if (norm.includes('southeastern') || norm === 'sec') return 'SEC';
  if (norm.includes('mountainwest') || norm.includes('mwc')) return 'MW';
  if (norm.includes('americanathletic') || norm.includes('aac')) return 'AAC';
  if (norm.includes('atlanticcoast') || norm.includes('acc')) return 'ACC';
  if (norm.includes('midamerican') || norm === 'mac' || norm === 'mc') return 'MAC';
  if (norm.includes('sunbelt') || norm.includes('sbc')) return 'SBC';

  const conf = (leagueData.confs || leagueData.conferences || []).find((c) => c.cid === cid);
  const rawAbbrev = String(conf?.abbrev || conf?.abbr || conf?.shortName || '').trim();

  if (rawAbbrev) return rawAbbrev;

  return rawName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function cleanDivisionName(divName) {
  return String(divName || '')
    .replace(/^USA\s*[-–—]\s*/i, '')
    .trim();
}

function buildNatChamps(leagueData, currentSeason, coachFilter = null) {
  const rowsByYear = new Map();

  for (const r of teamSeasonRows(leagueData)) {
    if (r.year >= currentSeason) continue;
    if (!rowsByYear.has(r.year)) rowsByYear.set(r.year, []);
    rowsByYear.get(r.year).push(r);
  }

  const champs = [];

  for (const entry of NAT_TITLE_ENTRIES) {
    const year = Number(entry.year);
    const teams = rowsByYear.get(year);
    if (!teams || !teams.length) continue;

    const maxRounds = Math.max(...teams.map((t) => t.playoffRoundsWon));
    if (maxRounds <= 0) continue;

    const champ = teams
      .filter((t) => t.playoffRoundsWon === maxRounds)
      .sort((a, b) => compareWinner(a, b, 'conference'))[0];

    const displayCoach =
      entry.aliases.find((a) => !a.startsWith('@')) || entry.aliases[0] || 'Unknown Coach';

    champs.push({
      year,
      teamName: champ.teamName,
      coach: displayCoach,
      aliases: entry.aliases,
      line: `**${year}** — ${champ.teamName} (${displayCoach})`,
    });
  }

  let out = champs.sort((a, b) => b.year - a.year);

  if (coachFilter) {
    const q = normalize(coachFilter);

    out = out.filter((c) =>
      c.aliases.some((a) => {
        const an = normalize(a);
        return an === q || (an.length >= 4 && q.includes(an)) || (q.length >= 4 && an.includes(q));
      })
    );
  }

  return out;
}

function buildGroupWinners(leagueData, scope, targetYear = null) {
  const rows = teamSeasonRows(leagueData).filter((r) => {
    if (targetYear !== null && r.year !== targetYear) return false;
    return scope === 'division'
      ? r.did !== undefined && r.did !== null
      : r.cid !== undefined && r.cid !== null;
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
      const divName = cleanDivisionName(getDivisionName(leagueData, winner.did));
      const groupName = `${confAbbrev} ${divName}`;

      winners.push({
        year: winner.year,
        groupId: winner.did,
        groupName,
        winner,
      });
    } else {
      const groupName = getConferenceName(leagueData, winner.cid);

      winners.push({
        year: winner.year,
        groupId: winner.cid,
        groupName,
        winner,
      });
    }
  }

  return winners.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return String(a.groupName).localeCompare(String(b.groupName));
  });
}

function makeFieldsFromGrouped(titledGroups) {
  const fields = [];
  let usedChars = 0;
  let remaining = 0;

  for (const group of titledGroups) {
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

  const q = normalize(focused.value);

  const names = [
    ...new Set(NAT_TITLE_ENTRIES.flatMap((e) => e.aliases).filter((a) => !a.startsWith('@'))),
  ]
    .filter((c) => !q || normalize(c).includes(q))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 25)
    .map((c) => ({ name: c, value: c }));

  return interaction.respond(names);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('championships')
    .setDescription('Show championship history')
    .addIntegerOption((opt) =>
      opt
        .setName('year')
        .setDescription('Show conference and division champions for a season')
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

    const year = interaction.options.getInteger('year');
    const coach = interaction.options.getString('coach');

    const currentSeason = Number(getCurrentSeason(leagueData));
    const targetYear = Number.isFinite(year) ? year : null;

    if (targetYear !== null && !coach) {
      const conf = buildGroupWinners(leagueData, 'conference', targetYear);
      const div = buildGroupWinners(leagueData, 'division', targetYear);

      if (!conf.length && !div.length) {
        return interaction.editReply(`❌ No championship data found for **${targetYear}**.`);
      }

      const { fields, remaining } = makeFieldsFromGrouped([
        {
          name: 'Conference Champions',
          lines: conf.map((x) => `**${x.groupName}** — ${teamOnlyLine(x.winner)}`),
        },
        {
          name: 'Division Champions',
          lines: div.map((x) => `**${x.groupName}** — ${teamOnlyLine(x.winner)}`),
        },
      ]);

      const embed = new EmbedBuilder()
        .setTitle(`Championships — ${targetYear}`)
        .setColor(0xf1c40f)
        .addFields(fields)
        .setTimestamp();

      if (remaining > 0) embed.setFooter({ text: `…and ${remaining} more` });

      return interaction.editReply({ embeds: [embed] });
    }

    const champs = buildNatChamps(leagueData, currentSeason, coach);

    if (!champs.length) {
      return interaction.editReply(
        coach ? `❌ No national titles found for **${coach}**.` : '❌ No national champions found.'
      );
    }

    const display = champs.slice(0, MAX_NAT_TITLES_DISPLAY);
    const footerText = `Showing ${display.length} most recent champions`;

    const embed = new EmbedBuilder()
      .setTitle(coach ? `National Champions — ${coach}` : 'National Champions')
      .setColor(0xf1c40f)
      .setDescription(display.map((c) => c.line).join('\n'))
      .setFooter({ text: footerText })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};