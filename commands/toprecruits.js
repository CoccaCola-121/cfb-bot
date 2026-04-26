// ============================================================
//  commands/toprecruits.js  — robust header detection
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData, getCurrentSeason } = require('../utils/data');
const { normalize, matchesTeam, safeNum } = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');

const INFO_SHEET_ID    = process.env.NZCFL_INFO_SHEET_ID || process.env.GOOGLE_SHEET_ID || '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';
const RANKS_SHEET_ID   = process.env.NZCFL_RECRUITING_RANKS_SHEET_ID   || '1VWzSOnixaQlJBQOw6zAyKdfo_XFhPuTFKO_5noKQEq4';
const RANKS_SHEET_NAME = process.env.NZCFL_RECRUITING_RANKS_SHEET_NAME || '247';

const POSITIONS = ['QB','RB','WR','TE','OL','DL','LB','CB','S','K','P'];

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

// Strip trailing punctuation so "Pos." matches "pos", "Committed?" matches "committed"
const cleanKey = (s) => String(s).toLowerCase().trim().replace(/[.:?!]+$/, '').trim();

function findCol(colMap, exactKeys, containsKeys = []) {
  for (const k of exactKeys) if (colMap.has(k)) return colMap.get(k);
  for (const [h, i] of colMap) {
    if (containsKeys.some(k => h.includes(k))) return i;
  }
  return -1;
}

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

  const nameCol   = findCol(colMap, ['name'],                          ['name']);
  const posCol    = findCol(colMap, ['pos', 'position'],               ['pos']);
  const ovrCol    = findCol(colMap, ['ovr', 'overall'],                ['ovr', 'overall']);
  const potCol    = findCol(colMap, ['pot', 'potential'],              ['pot', 'potential']);
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
        Ovr:       ovrCol    >= 0 ? safeNum(row[ovrCol])  : 0,
        Pot:       potCol    >= 0 ? safeNum(row[potCol])  : 0,
        commit:    commitCol >= 0 ? String(row[commitCol] || '').trim() : '',
      };
    })
    .filter((r) => r?.Name);
}

function build247RecruitMap(rows) {
  const recruitMap = new Map();
  for (const row of rows) {
    const teamRank = safeNum(row[0]); const school = String(row[1] || '').trim();
    if (!teamRank || !school) continue;
    if (normalize(school) === 'school') continue;
    const recruitIds = row.slice(4).map((v) => String(v || '').trim()).filter((v) => /^\d+$/.test(v));
    recruitIds.forEach((id, idx) => {
      if (!recruitMap.has(id)) recruitMap.set(id, { recruitRank: idx + 1, school });
    });
  }
  return recruitMap;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('toprecruits')
    .setDescription('Top recruits by position and commitments')
    .addStringOption((opt) =>
      opt.setName('position').setDescription('Position group (default: all top 25)').setRequired(false)
        .addChoices(
          ...POSITIONS.map((p) => ({ name: p, value: p })),
          { name: 'All (top 25)', value: 'ALL' },
        )
    )
    .addIntegerOption((opt) =>
      opt.setName('year').setDescription('Recruiting year (default: current season)').setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) return interaction.editReply('❌ No league data loaded.');

    const currentSeason    = Number(getCurrentSeason(leagueData));
    const targetYear       = interaction.options.getInteger('year') || currentSeason;
    const recruitSheetName = `${targetYear} Recruiting`;
    const posFilter        = (interaction.options.getString('position') || 'ALL').toUpperCase();

    let recruitRows, ranks247Rows;
    try {
      [recruitRows, ranks247Rows] = await Promise.all([
        fetchSheetCsv(INFO_SHEET_ID, recruitSheetName),
        fetchSheetCsv(RANKS_SHEET_ID, RANKS_SHEET_NAME),
      ]);
    } catch (err) {
      return interaction.editReply(`❌ Failed to load sheet data: ${err.message}`);
    }

    const allRecruits = toRecruitObjects(recruitRows);
    if (!allRecruits.length)
      return interaction.editReply(`❌ No recruit data found on tab **${recruitSheetName}**.`);

    const recruitMap = build247RecruitMap(ranks247Rows);

    const enriched = allRecruits.map((r) => {
      const rank247 = recruitMap.get(r.recruitId);
      return {
        rank:        Number(r.recruitId) || null,
        name:        r.Name,
        pos:         normalizePos(r.Pos),
        ovr:         typeof r.Ovr === 'number' ? r.Ovr : safeNum(r.Ovr),
        pot:         typeof r.Pot === 'number' ? r.Pot : safeNum(r.Pot),
        commit:      r.commit || 'Uncommitted',
        recruitRank: rank247?.recruitRank ?? null,
      };
    });

    let filtered = posFilter === 'ALL' ? enriched : enriched.filter((r) => r.pos === posFilter);

    // Future classes can't commit yet — hide "Uncommitted" noise
    if (targetYear > currentSeason) {
      filtered = filtered.filter((r) => {
        const c = String(r.commit || '').trim().toLowerCase();
        return c && c !== 'uncommitted' && c !== 'none' && c !== 'n/a' && c !== '-';
      });
    }

    // Sort by sheet-order rank (col A), then OVR/POT as tiebreakers
    const sorted = filtered.slice().sort((a, b) => {
      const ar = a.rank ?? Infinity;
      const br = b.rank ?? Infinity;
      if (ar !== br) return ar - br;
      if (b.ovr !== a.ovr) return b.ovr - a.ovr;
      return b.pot - a.pot;
    });

    const limit = posFilter === 'ALL' ? 25 : 15;
    const top   = sorted.slice(0, limit);

    if (!top.length)
      return interaction.editReply(`No recruiting data found for **${posFilter}** in **${targetYear}**.`);

    const lines = top.map((r, idx) => {
      const rankStr = r.rank ? `#${r.rank}` : 'Unranked';
      return `\`${String(idx + 1).padStart(3)}\` **${r.name}** (${r.pos}) — ${rankStr} | OVR ${r.ovr} | POT ${r.pot} | ${r.commit}`;
    });

    const title = posFilter === 'ALL'
      ? `📋 Top ${limit} Recruits — ${targetYear}`
      : `📋 Top ${limit} ${posFilter} Recruits — ${targetYear}`;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0x8e44ad)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${targetYear} recruiting class • NZCFL Info + 247 ranks` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};