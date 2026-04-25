// ============================================================
//  commands/recruitingclass.js  — flexible header detection
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData, getCurrentSeason, getTeamName, getTeamLogoUrl } = require('../utils/data');
const { fetchSheetCsv, normalize, matchesTeam, getTeamAliases, safeNum } = require('../utils/sheets');
const { getUserTeam } = require('../utils/userMap');

const INFO_SHEET_ID    = process.env.NZCFL_INFO_SHEET_ID || process.env.GOOGLE_SHEET_ID || '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';
const RANKS_SHEET_ID   = process.env.NZCFL_RECRUITING_RANKS_SHEET_ID   || '1VWzSOnixaQlJBQOw6zAyKdfo_XFhPuTFKO_5noKQEq4';
const RANKS_SHEET_NAME = process.env.NZCFL_RECRUITING_RANKS_SHEET_NAME || 'Recruiting Rankings';
const RANKS_SHEET_GID  = process.env.NZCFL_RECRUITING_RANKS_SHEET_GID  || '';

function ordinal(n) {
  const num = Number(n); if (!Number.isFinite(num) || num <= 0) return '?';
  const m = num % 100; if (m >= 11 && m <= 13) return `${num}th`;
  switch (num % 10) {
    case 1: return `${num}st`; case 2: return `${num}nd`;
    case 3: return `${num}rd`; default: return `${num}th`;
  }
}

function normalizePos(pos) {
  const p = String(pos || '').toUpperCase().trim().replace(/[\s\d/\\.,-]+$/, '');
  if (['OT','OG','OC','C','LT','RT','LG','RG'].includes(p)) return 'OL';
  if (['DE','DT','NT','NG'].includes(p))                     return 'DL';
  if (['ILB','OLB','MLB'].includes(p))                       return 'LB';
  if (['FS','SS','SAF'].includes(p))                         return 'S';
  if (['DB'].includes(p))                                    return 'CB';
  if (['PK','KK'].includes(p))                               return 'K';
  if (['HB','FB'].includes(p))                               return 'RB';
  return p;
}

const cleanKey = (s) => String(s).toLowerCase().trim().replace(/[.:?!]+$/, '').trim();

function findCol(colMap, exactKeys, containsKeys = []) {
  for (const k of exactKeys) if (colMap.has(k)) return colMap.get(k);
  for (const [h, i] of colMap) {
    if (containsKeys.some((k) => h.includes(k))) return i;
  }
  return -1;
}

// ── Parse recruiting sheet ───────────────────────────────────
function toRecruitObjects(rows) {
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i].some((c) => cleanKey(c) === 'name')) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return [];

  const header   = rows[headerIdx];
  const dataRows = rows.slice(headerIdx + 1);
  const colMap   = new Map();
  header.forEach((h, i) => colMap.set(cleanKey(h), i));

  const nameCol   = findCol(colMap, ['name'],                  ['name']);
  const posCol    = findCol(colMap, ['pos', 'position'],       ['pos']);
  const ovrCol    = findCol(colMap, ['ovr', 'overall', 'rtg'], ['ovr', 'overall']);
  const potCol    = findCol(colMap, ['pot', 'potential'],      ['pot', 'potential']);
  const commitCol = findCol(
    colMap,
    ['committed', 'commit', 'team', 'school', 'destination', 'pledge'],
    ['commit', 'pledge']
  );

  return dataRows
    .map((row) => {
      const name = nameCol >= 0 ? String(row[nameCol] || '').trim() : String(row[1] || '').trim();
      if (!name) return null;
      return {
        recruitId: String(row[0] || '').trim(),   // col A = overall rank in this class
        Name:      name,
        Pos:       posCol    >= 0 ? String(row[posCol]  || '').trim() : '?',
        Ovr:       ovrCol    >= 0 ? String(row[ovrCol]  || '').trim() : '0',
        Pot:       potCol    >= 0 ? String(row[potCol]  || '').trim() : '0',
        commit:    commitCol >= 0 ? String(row[commitCol] || '').trim() : '',
      };
    })
    .filter((r) => r?.Name);
}

// ── 247 team-level data ──────────────────────────────────────
// A = rank, B = school, C = score, D = # recruits.
// Teams with 0 recruits are forced to share the lowest 0-recruit rank.
function build247Data(rows) {
  const teams = [];
  for (const row of rows) {
    const teamRank = safeNum(row[0]);
    const school   = String(row[1] || '').trim();
    if (!teamRank || !school) continue;
    if (normalize(school) === 'school' || normalize(row[0]) === 'rank') continue;
    teams.push({
      school,
      teamRank,
      rankScore:   safeNum(row[2]),
      numRecruits: safeNum(row[3]),
    });
  }

  const zeros   = teams.filter((t) => t.numRecruits === 0);
  const tieRank = zeros.length ? Math.min(...zeros.map((t) => t.teamRank)) : null;

  const teamMap = new Map();
  for (const t of teams) {
    const tied = t.numRecruits === 0 && tieRank !== null;
    teamMap.set(normalize(t.school), {
      school:      t.school,
      teamRank:    tied ? tieRank : t.teamRank,
      rankScore:   t.rankScore,
      numRecruits: t.numRecruits,
      tied,
    });
  }
  return teamMap;
}

function get247TeamInfo(team, teamMap) {
  for (const alias of getTeamAliases(team)) {
    if (teamMap.has(alias)) return teamMap.get(alias);
  }
  const candidates = [getTeamName(team), team.name, team.region, team.abbrev]
    .filter(Boolean).map(normalize);
  for (const n of candidates) {
    if (teamMap.has(n)) return teamMap.get(n);
  }
  for (const [, info] of teamMap) {
    if (matchesTeam(info.school, team)) return info;
  }
  for (const [key, info] of teamMap) {
    for (const cand of candidates) {
      if (key.length  >= 4 && cand.includes(key)) return info;
      if (cand.length >= 4 && key.includes(cand)) return info;
    }
  }
  return null;
}

function buildPosRankMap(allRecruits) {
  const byPos = new Map();
  for (const r of allRecruits) {
    const pos = normalizePos(r.Pos);
    if (!pos) continue;
    if (!byPos.has(pos)) byPos.set(pos, []);
    byPos.get(pos).push(r);
  }
  const out = new Map();
  for (const [, list] of byPos) {
    list.sort((a, b) => (Number(a.recruitId) || Infinity) - (Number(b.recruitId) || Infinity));
    list.forEach((r, idx) => out.set(r.recruitId, idx + 1));
  }
  return out;
}

// Try GID first (most reliable for tabs with spaces), then several tab-name candidates
async function fetchRanks247() {
  if (RANKS_SHEET_GID) {
    try {
      const rows = await fetchSheetCsv(RANKS_SHEET_ID, RANKS_SHEET_GID, true);
      if (rows && rows.length > 1) return rows;
    } catch (_e) { /* fall through */ }
  }
  const tried = new Set();
  for (const tab of [RANKS_SHEET_NAME, 'Recruiting Rankings', '247', 'Rankings']) {
    if (!tab || tried.has(tab)) continue;
    tried.add(tab);
    try {
      const rows = await fetchSheetCsv(RANKS_SHEET_ID, tab);
      if (rows && rows.length > 1) return rows;
    } catch (_e) { /* try next */ }
  }
  return [];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recruitingclass')
    .setDescription('Show upcoming recruiting class for a team')
    .addStringOption((opt) =>
      opt.setName('team').setDescription('Team abbreviation, e.g. MSU (defaults to your linked team if you ran /iam)').setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) return interaction.editReply('❌ No league data loaded.');

    const currentSeason    = Number(getCurrentSeason(leagueData));
    const recruitSheetName = `${currentSeason} Recruiting`;
    const teamArg = interaction.options.getString('team');
    let abbrev = null;
    let team = null;

    if (teamArg) {
      abbrev = teamArg.toUpperCase().trim();
      team = leagueData.teams.find((t) => !t.disabled && String(t.abbrev || '').toUpperCase() === abbrev);
      if (!team) return interaction.editReply(`❌ No active team with abbreviation **${abbrev}**.`);
    } else {
      team = await getUserTeam(leagueData, interaction.user.id);
      if (!team) {
        return interaction.editReply(
          '❌ No team specified and no linked coach found. ' +
            'Pass a team (e.g. `team: MSU`) or run `/iam coach:<your name>` first.'
        );
      }
      abbrev = String(team.abbrev || '').toUpperCase().trim();
    }

    let recruitRows, ranks247Rows;
    try {
      [recruitRows, ranks247Rows] = await Promise.all([
        fetchSheetCsv(INFO_SHEET_ID, recruitSheetName),
        fetchRanks247(),
      ]);
    } catch (err) {
      return interaction.editReply(`❌ Failed to load sheet data: ${err.message}`);
    }

    const allRecruits = toRecruitObjects(recruitRows);
    if (!allRecruits.length) {
      return interaction.editReply(`❌ No recruit data found on tab **${recruitSheetName}** — check that the tab name matches and headers include "Name".`);
    }

    const teamMap    = build247Data(ranks247Rows);
    const class247   = get247TeamInfo(team, teamMap);
    const posRankMap = buildPosRankMap(allRecruits);

    const teamRecruits = allRecruits
      .filter((r) => matchesTeam(r.commit, team))
      .map((r) => ({
        rank:    Number(r.recruitId) || null,
        name:    r.Name,
        pos:     normalizePos(r.Pos),
        posRank: posRankMap.get(r.recruitId) || null,
        ovr:     safeNum(r.Ovr),
        pot:     safeNum(r.Pot),
      }))
      .sort((a, b) => {
        const ra = a.rank ?? Infinity;
        const rb = b.rank ?? Infinity;
        if (ra !== rb) return ra - rb;
        if (b.pot !== a.pot) return b.pot - a.pot;
        return b.ovr - a.ovr;
      });

    if (!teamRecruits.length) {
      return interaction.editReply(`❌ No commits found for **${abbrev}** on **${recruitSheetName}**.\n*(If the team just got commits, the sheet may not be updated yet.)*`);
    }

    const fiveStar  = teamRecruits.filter((r) => r.rank && r.rank >= 1   && r.rank <= 25 ).length;
    const fourStar  = teamRecruits.filter((r) => r.rank && r.rank >= 26  && r.rank <= 250).length;
    const threeStar = teamRecruits.filter((r) => r.rank && r.rank >= 251 && r.rank <= 500).length;

    // Leading number = overall rank; OL#1 conveys position rank; no redundant middle "#X"
    const commitLines = teamRecruits.map((r) => {
      const posLabel  = r.posRank ? `${r.pos}#${r.posRank}` : r.pos;
      const rankLabel = r.rank ? `#${r.rank}` : '—';
      return `**${rankLabel}.** ${r.name} — ${posLabel} (${r.ovr}/${r.pot})`;
    });

    let commitsField = '';
    for (const line of commitLines) {
      const next = commitsField ? `${commitsField}\n${line}` : line;
      if (next.length > 1020) { commitsField += '\n*…and more*'; break; }
      commitsField = next;
    }

    const rankStr = class247?.teamRank
      ? (class247.tied ? `T-${ordinal(class247.teamRank)}` : ordinal(class247.teamRank))
      : '?';
    const scoreStr = (class247 && Number.isFinite(class247.rankScore))
      ? class247.rankScore.toFixed(3)
      : '?';

    // Two-line summary — compact enough to fit mobile without mid-sentence wrap
    const summaryValue = [
      `Commits: **${teamRecruits.length}**  •  Class Rank: **${rankStr}**  •  Class Score: **${scoreStr}**`,
      `5★ **${fiveStar}**  •  4★ **${fourStar}**  •  3★ **${threeStar}**`,
    ].join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`🧢 ${getTeamName(team)} (${abbrev}) — ${recruitSheetName}`)
      .setColor(0x8e44ad)
      .addFields(
        { name: 'Class Summary', value: summaryValue,            inline: false },
        { name: 'Commits',       value: commitsField || '—',     inline: false },
      )
      .setFooter({ text: `${recruitSheetName} • NZCFL Info + 247 ranks` })
      .setTimestamp();

    if (teamMap.size === 0) {
      embed.setDescription('⚠️ 247 rankings tab could not be loaded — class rank/score unavailable.');
    }

    const logo = getTeamLogoUrl(team);
    if (logo) embed.setThumbnail(logo);
    return interaction.editReply({ embeds: [embed] });
  },
};