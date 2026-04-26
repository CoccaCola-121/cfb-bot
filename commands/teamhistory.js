// ============================================================
//  commands/teamhistory.js
//
//  For a given team:
//    • Coaches who have led the program (from Resume sheet
//      per-year history), grouped into eras with cumulative
//      W/L per stretch.
//    • National-title years won by THIS program (matched via
//      whichever coach was listed at the team that year).
//    • This year's rival — defined as the week-12 opponent
//      in the latest loaded football-gm export. (Rivalry Week
//      is a CFB tradition: every team's rival plays in week 12.)
//
//  Heavy lookups go through the cached league snapshot +
//  cached sheet wrapper, so back-to-back calls are cheap.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  findTeamByName,
  getTeamSchedule,
  getTeamLogoUrl,
  getTeamName,
} = require('../utils/data');
const { normalize } = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');
const { NAT_TITLE_ENTRIES, NAT_TITLE_ASTERISK } = require('../utils/natTitles');
const { getUserTeam } = require('../utils/userMap');

const RESUME_SHEET_ID = '1S3EcS3V6fxfN5qxF6R-MSb763AL6W11W-QqytehCUkU';
const RESUME_GID      = '1607727992';

const RIVALRY_WEEK = 12;

// ── Resume sheet parser, focused on (year, coach, team, record) tuples ─
// Returns Array<{year, coach, team, wins, losses}>.
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

    // Build year → {record, team} for THIS coach's row
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

// Group consecutive year rows for a given (coach, team) into spans.
function buildEras(coachRows) {
  if (!coachRows.length) return [];

  // Sort by year ascending
  const sorted = [...coachRows].sort((a, b) => +a.year - +b.year);
  const spans = [];
  let cur = null;

  for (const r of sorted) {
    if (cur && cur.coach === r.coach && +r.year === +cur.endYear + 1) {
      cur.endYear = r.year;
      cur.wins   += r.wins;
      cur.losses += r.losses;
    } else {
      if (cur) spans.push(cur);
      cur = { coach: r.coach, startYear: r.year, endYear: r.year, wins: r.wins, losses: r.losses };
    }
  }
  if (cur) spans.push(cur);
  return spans;
}

// Get the years a particular team won the national title, by cross-referencing
// nat-title coach aliases with that year's coach for the team in resumeRows.
function teamChampionshipYears(teamAliasesNorm, allRows) {
  const out = [];
  for (const e of NAT_TITLE_ENTRIES) {
    // Find who coached at this team in this year
    const yearRows = allRows.filter((r) => r.year === e.year && r.team);
    const winner = yearRows.find((r) =>
      e.aliases.some((a) => {
        const an = normalize(a);
        const cn = normalize(r.coach);
        return an === cn || (an.length >= 4 && cn.includes(an)) || (cn.length >= 4 && an.includes(cn));
      })
    );
    if (winner && teamAliasesNorm.has(normalize(winner.team))) {
      out.push({ year: e.year, coach: winner.coach });
    }
  }
  return out;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('teamhistory')
    .setDescription('Show coaches, championships, and current rival for a team')
    .addStringOption((opt) =>
      opt.setName('team').setDescription('Team name or abbreviation (defaults to your linked team)').setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData) {
      return interaction.editReply('❌ No league data loaded. Ask a commissioner to run `/loadweek`.');
    }

    let teamArg = interaction.options.getString('team');
    let team    = null;

    if (teamArg) {
      team = findTeamByName(leagueData, teamArg);
    } else {
      team = await getUserTeam(leagueData, interaction.user.id);
      if (!team) {
        return interaction.editReply(
          '❌ No team specified and no linked coach found. ' +
            'Pass a team (e.g. `team: Michigan`) or run `/iam coach:<your name>` first.'
        );
      }
    }

    if (!team) return interaction.editReply(`❌ No team found matching **${teamArg}**.`);

    const teamLabel = `${team.region} ${team.name}`;
    const teamAliasesNorm = new Set(
      [getTeamName(team), team.region, team.name, team.abbrev]
        .filter(Boolean)
        .map((s) => normalize(s))
        .filter(Boolean)
    );

    // Resume sheet → all (year, coach, team, record) rows
    let resumeRows;
    try {
      resumeRows = await fetchSheetCsv(RESUME_SHEET_ID, RESUME_GID, true);
    } catch (err) {
      return interaction.editReply(`❌ Could not load resume sheet: ${err.message}`);
    }

    const allRows = parseResumeRows(resumeRows);
    const teamRows = allRows.filter((r) => r.team && teamAliasesNorm.has(normalize(r.team)));

    if (!teamRows.length) {
      return interaction.editReply(
        `*No coaching history found for ${teamLabel} on the resume sheet yet.*`
      );
    }

    // Group by coach for era spans, sorted newest era last so reverse for display
    const coachToRows = new Map();
    for (const r of teamRows) {
      if (!coachToRows.has(r.coach)) coachToRows.set(r.coach, []);
      coachToRows.get(r.coach).push(r);
    }

    const allEras = [];
    for (const [, rows] of coachToRows) allEras.push(...buildEras(rows));
    allEras.sort((a, b) => +b.startYear - +a.startYear);

    // Era display: newest 12
    const eraLines = allEras.slice(0, 12).map((s) => {
      const start = String(s.startYear);
      const end   = String(s.endYear);
      const yrs   = start === end ? start : `${start}–${end}`;
      const rec   = s.wins + s.losses > 0 ? ` (${s.wins}-${s.losses})` : '';
      return `**${yrs}:** ${s.coach}${rec}`;
    });

    // Championship years for this team
    const champYears = teamChampionshipYears(teamAliasesNorm, allRows);
    const champLine = champYears.length
      ? champYears
          .map((c) => {
            const star = NAT_TITLE_ASTERISK.has(c.coach) || NAT_TITLE_ASTERISK.has(c.coach.toUpperCase()) ? '*' : '';
            return `🏆 **${c.year}** — ${c.coach}${star}`;
          })
          .join('\n')
      : '*No national titles on record.*';

    // Current rival — week 12 opponent in current schedule
    const sched = getTeamSchedule(leagueData, team.abbrev);
    let rivalLine = '*Rivalry Week opponent unknown — schedule not loaded yet.*';
    if (sched) {
      const wk12 = sched.games.find((g) => g.week === RIVALRY_WEEK);
      if (wk12) {
        const playedTag = wk12.teamScore + wk12.oppScore > 0
          ? ` — ${wk12.result} ${wk12.teamScore}-${wk12.oppScore}`
          : ' — *upcoming*';
        rivalLine = `🔥 **${wk12.opponent}** (${wk12.opponentAbbrev})${playedTag}`;
      } else {
        rivalLine = '*No week 12 game scheduled this season.*';
      }
    }

    const fields = [
      {
        name: `🏆 Championships (${champYears.length})`,
        value: champLine.slice(0, 1020),
        inline: false,
      },
      {
        name: `📋 Coaching Eras (${allEras.length})`,
        value: eraLines.length ? eraLines.join('\n').slice(0, 1020) : '*(none)*',
        inline: false,
      },
      {
        name: `🔥 Rivalry Week (Wk ${RIVALRY_WEEK}) — ${sched?.season || '?'}`,
        value: rivalLine,
        inline: false,
      },
    ];

    const embed = new EmbedBuilder()
      .setTitle(`📜 ${teamLabel} (${team.abbrev}) — Program History`)
      .setColor(0x2c3e50)
      .addFields(fields)
      .setFooter({ text: 'Resume sheet history • Rivalry = wk 12' })
      .setTimestamp();

    const logo = getTeamLogoUrl(team);
    if (logo) embed.setThumbnail(logo);

    return interaction.editReply({ embeds: [embed] });
  },
};
