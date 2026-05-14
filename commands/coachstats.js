// ============================================================
//  commands/coachstats.js  —  active coaches only
//  CSV:    accolades, contract, years, conduct
//  Resume: career W/L, per-year records, recent history
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData, getCurrentSeason, getTeamLogoUrl, getTeamName } = require('../utils/data');
const { normalize } = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');
const { getUserCoachName } = require('../utils/userMap');
const { applyOverridesToResume } = require('../utils/coachOverrides');
const { getNatTitleYears } = require('../utils/natTitles');
const { isLive } = require('../utils/seasonMode');

const COACH_SHEET_ID  = process.env.NZCFL_COACH_SHEET_ID  || '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';
const COACH_SHEET_TAB = process.env.NZCFL_COACH_SHEET_TAB || 'Coach';
const RESUME_SHEET_ID = '1S3EcS3V6fxfN5qxF6R-MSb763AL6W11W-QqytehCUkU';
const RESUME_GID      = '1607727992';

// ── Parse Coach CSV ──────────────────────────────────────────
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
      coach, team,
      sheetRank:   ni(2),     // column C — same rank /valueboard displays
      years:       ni(4),
      promFailed:  ni(5),
      promKept:    ni(6),
      breaches:    ni(8),
      contractYrs: ni(9),
      bowlWins:    ni(10),
      divTitles:   ni(11),
      confTitles:  ni(12),
      playoffs:    ni(13),
      natTitles:   ni(14),
    });
  }
  return coaches;
}

// ── Parse Resume Sheet ───────────────────────────────────────
// Returns Map<resumeKey, { record, wins, losses, pct, history }>
// history = [{year, record, team}] sorted ascending
function parseResumeSheet(rows) {
  const map = new Map();

  // Find header row (contains 'Coach' and 'Total')
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

  // Find year columns: headers that are 4-digit years
  // Year blocks appear twice (record years, then team years)
  const yearIdxs = header.map((h, i) => (/^\d{4}$/.test(h) ? i : -1)).filter(i => i >= 0);
  const seen = new Set(); let splitAt = -1;
  for (let i = 0; i < yearIdxs.length; i++) {
    const y = header[yearIdxs[i]];
    if (seen.has(y)) { splitAt = i; break; }
    seen.add(y);
  }
  const recordYearCols = splitAt >= 0 ? yearIdxs.slice(0, splitAt) : yearIdxs;
  const teamYearCols   = splitAt >= 0 ? yearIdxs.slice(splitAt)    : [];

  for (let i = hi + 1; i < rows.length; i++) {
    const r     = rows[i];
    const coach = (r[coachCol] || '').trim();
    const total = (r[totalCol] || '').trim();
    if (!coach) continue;

    const m     = total.match(/^(\d+)-(\d+)$/);
    const wins   = m ? parseInt(m[1]) : 0;
    const losses = m ? parseInt(m[2]) : 0;
    const games  = wins + losses;

    // Build year history
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

    const allYears = [...new Set([...recordByYear.keys(), ...teamByYear.keys()])]
      .sort((a, b) => +a - +b);

    const history = allYears.map(y => ({
      year:   y,
      record: recordByYear.get(y) || null,
      team:   teamByYear.get(y)   || null,
    }));

    map.set(normalize(coach), { record: total, wins, losses, pct: games > 0 ? wins / games : 0, history });
  }
  return map;
}

// ── Ranking source ──────────────────────────────────────────
// Coach rank comes straight from the NZCFL Info Coach sheet
// (column C) — the same source /valueboard uses. No formula here:
// whatever the sheet says is what gets displayed, so the two
// commands always agree.
function computeRanks(coaches) {
  return [...coaches]
    .map(c => ({ ...c, rank: c.sheetRank > 0 ? c.sheetRank : null }))
    .sort((a, b) => {
      if (a.rank == null && b.rank == null) return 0;
      if (a.rank == null) return 1;
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    });
}

function findTeamByName(leagueData, name) {
  if (!leagueData?.teams) return null;
  const t = normalize(name);
  return leagueData.teams.find(x => !x.disabled && (
    normalize(getTeamName(x)) === t || normalize(x.region) === t ||
    normalize(x.name) === t || normalize(x.abbrev) === t
  )) || null;
}

// Build team history spans like: "2050-2055: Michigan State (65-0)"
function buildTeamHistory(history, currentSeason) {
  // Only entries with a team
  const withTeam = history.filter(h => h.team).sort((a, b) => +a.year - +b.year);
  if (!withTeam.length) return [];

  const spans = [];
  let startYear = withTeam[0].year;
  let prevYear  = withTeam[0].year;
  let team      = withTeam[0].team;
  let w = 0, l = 0;

  function parseWL(rec) {
    const m = (rec || '').match(/^(\d+)-(\d+)$/);
    return m ? { w: +m[1], l: +m[2] } : null;
  }

  // Add first entry's record
  const p0 = parseWL(history.find(h => h.year === startYear && h.record)?.record);
  if (p0) { w += p0.w; l += p0.l; }

  for (let i = 1; i < withTeam.length; i++) {
    const curr = withTeam[i];
    const consecutive = +curr.year === +prevYear + 1;
    const sameTeam    = normalize(curr.team) === normalize(team);

    if (sameTeam && consecutive) {
      // Find record for this year
      const entry = history.find(h => h.year === curr.year && h.record);
      const p = parseWL(entry?.record);
      if (p) { w += p.w; l += p.l; }
      prevYear = curr.year;
    } else {
      spans.push({ startYear, endYear: prevYear, team, w, l });
      startYear = curr.year;
      prevYear  = curr.year;
      team      = curr.team;
      w = 0; l = 0;
      const entry = history.find(h => h.year === curr.year && h.record);
      const p = parseWL(entry?.record);
      if (p) { w += p.w; l += p.l; }
    }
  }
  spans.push({ startYear, endYear: prevYear, team, w, l });

  return spans.map(s => {
    const start = String(s.startYear);
    const end   = String(s.endYear);
    // Active at current team: use "2056- " format with space
    const yearLabel = (end === currentSeason || (!currentSeason && s === spans[spans.length - 1]))
      ? `${start}- `
      : start === end
        ? start
        : `${start}-${end.slice(-2)}`;
    const recStr = s.w + s.l > 0 ? ` (${s.w}-${s.l})` : '';
    return `**${yearLabel}:** ${s.team}${recStr}`;
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coachstats')
    .setDescription('Look up an active coach')
    .addStringOption(opt =>
      opt.setName('name').setDescription('Coach name or team (defaults to you if you ran /iam)').setRequired(false)
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

    const resumeMap  = parseResumeSheet(resumeRows);
    const csvCoaches = parseCoachCsv(csvRows);
    const leagueData = getLatestLeagueData();
    const currentSeason = leagueData ? String(getCurrentSeason(leagueData)) : null;

    // Patch current season live record into resume total
    // The resume sheet Total column won't include the in-progress season,
    // so we add the current team's live record from the Football GM JSON.
    // In offseason mode the resume sheet is authoritative — the FGM export
    // is stale or already advanced past the natty — so we skip the patch
    // entirely and trust whatever finalized record the sheet shows.
    const liveMode = isLive(leagueData);
    function patchCurrentSeason(coach, resume) {
      if (!liveMode) return resume;
      if (!leagueData || !currentSeason || !resume) return resume;
      const leagueTeam = findTeamByName(leagueData, coach.team);
      if (!leagueTeam) return resume;
      const { getLiveTeamRecord } = require('../utils/data');
      const liveTotals = getLiveTeamRecord(leagueData, leagueTeam, getCurrentSeason(leagueData));
      if (!liveTotals) return resume;

      const liveW = liveTotals.wins;
      const liveL = liveTotals.losses;
      if (liveW + liveL === 0) return resume;

      const existingYear = resume.history.find(h => h.year === currentSeason && h.record);
      const existingMatch = existingYear?.record?.match(/^(\d+)-(\d+)$/);
      const existingW = existingMatch ? Number(existingMatch[1]) : 0;
      const existingL = existingMatch ? Number(existingMatch[2]) : 0;

      const totalW = resume.wins - existingW + liveW;
      const totalL = resume.losses - existingL + liveL;
      const liveRecord = `${liveW}-${liveL}`;
      const newHistory = [
        ...resume.history.filter(h => h.year !== currentSeason),
        { year: currentSeason, record: liveRecord, team: coach.team, livePatched: true },
      ].sort((a, b) => +a.year - +b.year);
      return {
        ...resume,
        wins:   totalW,
        losses: totalL,
        pct:    totalW + totalL > 0 ? totalW / (totalW + totalL) : 0,
        record: `${totalW}-${totalL}`,
        history: newHistory,
      };
    }

    // Attach resume data to each CSV coach.
    // Order matters: first patch the live current-season W/L on top of the
    // resume sheet, then apply this coach's manual /recordupdate overrides
    // so they hard-overwrite the affected year (and re-derive career totals).
    //
    // We also re-derive `years` from the resume history (count of years the
    // coach has a record or team filled in) so the "X seasons coached" line
    // auto-grows when a new finalized year lands in the sheet, instead of
    // depending on someone manually bumping the Coach tab's Years column.
    // Falls back to the CSV value if the resume sheet has no history.
    const coaches = csvCoaches.map(c => {
      const rawResume = resumeMap.get(normalize(c.coach)) || null;
      const patched   = patchCurrentSeason(c, rawResume);
      const finalResume = applyOverridesToResume(patched, c.coach);
      const derivedYears = finalResume?.history?.length || 0;
      const years = derivedYears > 0 ? derivedYears : c.years;
      return { ...c, years, resume: finalResume };
    });

    const ranked = computeRanks(coaches);
    if (!ranked.length) return interaction.editReply('❌ No coach data found.');

    const nameArg = interaction.options.getString('name');
    let queryRaw = nameArg;
    if (!queryRaw) {
      queryRaw = getUserCoachName(interaction.user.id);
      if (!queryRaw) {
        return interaction.editReply(
          '❌ No coach specified and no linked coach found. ' +
            'Pass a name (e.g. `name: Bob Smith`) or run `/iam coach:<your name>` first.'
        );
      }
    }
    const query = normalize(queryRaw);

    function matches(c) {
      const cn = normalize(c.coach);
      const tn = normalize(c.team);
      if (cn === query) return true;
      if (cn.startsWith(query) && cn.length > query.length && /[_\d]/.test(cn[query.length])) return false;
      if (query.length >= 3 && cn.includes(query)) return true;
      if (query.length >= 3 && tn.includes(query)) return true;
      return false;
    }

    const found = ranked.filter(matches);
    if (!found.length) return interaction.editReply(`❌ No active coach found matching **${queryRaw}**.`);

    if (found.length > 6) {
      const list = found.slice(0, 8).map(c => `• ${c.coach} (${c.team})`).join('\n');
      return interaction.editReply(`Found ${found.length} matches — be more specific:\n${list}`);
    }

    const embeds = found.slice(0, 3).map(c => {
      const leagueTeam = findTeamByName(leagueData, c.team);
      const logo       = leagueTeam ? getTeamLogoUrl(leagueTeam) : null;
      const natYears    = getNatTitleYears(c.coach);
      const natSet      = new Set(natYears);

      // Career record
      const recStr = c.resume
        ? `${c.resume.record} (${c.resume.pct.toFixed(3)})`
        : '—';

      // National titles display
      const natDisplay = c.natTitles > 0
        ? `**${c.natTitles}**${natYears.length ? ` *(${natYears.join(', ')})*` : ''}`
        : '**0**';

      // Recent seasons — last 8 from history, trophy on nat title years
      const recentLines = c.resume?.history
        ? c.resume.history
            .filter(h => h.record || h.team)
            .slice(-8)
            .map(h => {
              const trophy = natSet.has(h.year) ? ' 🏆' : '';
              const parts  = [];
              if (h.record) parts.push(h.record);
              if (h.team)   parts.push(h.team);
              return `**${h.year}:** ${parts.join(' — ')}${trophy}`;
            })
        : [];

      // Conduct: only show contract breaches, not promise counts
      const conductParts = [];
      if (c.breaches > 0) conductParts.push(`*${c.breaches} contract breach${c.breaches > 1 ? 'es' : ''}*`);

      const fields = [
        {
          name: 'Career',
          value: [
            `Record: **${recStr}**`,
            `Years:  **${c.years}**`,
            `Rank:   **${c.rank ? `#${c.rank}` : '—'}**`,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Accolades',
          value: [
            `Nat. Titles:  ${natDisplay}`,
            `Conf. Titles: **${c.confTitles}**`,
            `Div. Titles:  **${c.divTitles}**`,
            `Playoff App.: **${c.playoffs}**`,
            `Bowl Wins:    **${c.bowlWins}**`,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Contract',
          value: [
  `Yrs Remaining: **${c.contractYrs}**`,
  ...(conductParts.length ? [conductParts.join(' • ')] : []),
].join('\n'),
          inline: false,
        },
      ];

      // Team history spans
      const teamHistoryLines = buildTeamHistory(c.resume?.history || [], currentSeason);
      if (teamHistoryLines.length) {
        // Truncate to fit Discord's 1024-char field limit
        let teamHistValue = '';
        for (const line of teamHistoryLines) {
          const next = teamHistValue ? `${teamHistValue}\n${line}` : line;
          if (next.length > 1020) break;
          teamHistValue = next;
        }
        fields.push({
          name: 'Team History',
          value: teamHistValue,
          inline: false,
        });
      }

      // Recent seasons (last 6, excluding current)
      if (recentLines.length) {
        fields.push({
          name: 'Recent Seasons',
          value: recentLines.join('\n'),
          inline: false,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`🧢 ${c.coach}`)
        .setColor(0x2b4b8c)
        .setDescription(`**${c.team}**  •  ${c.years} season${c.years !== 1 ? 's' : ''} coached`)
        .addFields(fields)
        .setFooter({ text: 'Active coaches only • NZCFL Coach Sheet' })
        .setTimestamp();

      if (logo) embed.setThumbnail(logo);
      return embed;
    });

    return interaction.editReply({ embeds });
  },
};
