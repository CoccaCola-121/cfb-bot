// ============================================================
//  commands/trashtalk.js
//
//  Generates one playful jab aimed at an opposing team / coach.
//  Pulls real data so the burns aren't generic:
//    • Current-season W/L from the league snapshot
//    • Career win % from the Resume sheet
//    • Title drought (years since last nat-title)
//    • Last loss + last blowout from the schedule
//
//  Light-hearted by design. Pick a template that matches the
//  most embarrassing real fact, then fill it in.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  findTeamByName,
  getTeamSchedule,
  getTeamLogoUrl,
  getCurrentSeason,
  getLatestTeamSeason,
  safeNumber,
  getTeamName,
} = require('../utils/data');
const { normalize } = require('../utils/sheets');
const { fetchSheetCsvCached: fetchSheetCsv } = require('../utils/sheetCache');
const { NAT_TITLE_ENTRIES } = require('../utils/natTitles');

const RESUME_SHEET_ID = '1S3EcS3V6fxfN5qxF6R-MSb763AL6W11W-QqytehCUkU';
const RESUME_GID      = '1607727992';
const COACH_SHEET_ID  = process.env.NZCFL_COACH_SHEET_ID  || '1OwHRRfBWsZa_gk5YWXWNbb0ij1qHA8wrtbPr9nwHSdY';
const COACH_SHEET_TAB = process.env.NZCFL_COACH_SHEET_TAB || 'Coach';

// Pick a random element
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Map team alias from coach sheet to a coach name (best-effort lookup)
function findCoachOnSheet(rows, teamName) {
  const target = normalize(teamName);
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    if (rows[i].some((c) => c.toLowerCase().includes('coach') && c.toLowerCase() !== 'coach rankings')) {
      hi = i; break;
    }
  }
  if (hi === -1) hi = 1;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const coach = (r[0] || '').trim();
    const t     = (r[1] || '').trim();
    if (!coach || !t) continue;
    if (normalize(t) === target || normalize(t).includes(target) || target.includes(normalize(t))) {
      const ni = (idx) => {
        const v = parseFloat(r[idx]);
        return isNaN(v) ? 0 : Math.round(v);
      };
      return {
        coach,
        team: t,
        years:      ni(4),
        natTitles:  ni(14),
        confTitles: ni(12),
        playoffs:   ni(13),
      };
    }
  }
  return null;
}

// Resume → career W-L for one coach
function findCareerRecord(rows, coachName) {
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map((c) => c.toLowerCase().trim());
    if (r.includes('coach') && r.includes('total')) { hi = i; break; }
  }
  if (hi === -1) return null;
  const header   = rows[hi].map((c) => c.trim());
  const coachCol = header.findIndex((h) => h.toLowerCase() === 'coach');
  const totalCol = header.findIndex((h) => h.toLowerCase() === 'total');
  if (coachCol === -1 || totalCol === -1) return null;

  const target = normalize(coachName);
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const coach = (r[coachCol] || '').trim();
    if (!coach) continue;
    if (normalize(coach) === target) {
      const m = (r[totalCol] || '').trim().match(/^(\d+)-(\d+)$/);
      if (m) return { wins: +m[1], losses: +m[2] };
    }
  }
  return null;
}

function lastNatTitleYear(coachName) {
  const q = normalize(coachName);
  let lastY = null;
  for (const e of NAT_TITLE_ENTRIES) {
    if (e.aliases.some((a) => {
      const an = normalize(a);
      return an === q || (an.length >= 4 && q.includes(an)) || (q.length >= 4 && an.includes(q));
    })) {
      if (lastY === null || +e.year > +lastY) lastY = e.year;
    }
  }
  return lastY;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trashtalk')
    .setDescription('Generate a (playful) jab at a rival team')
    .addStringOption((opt) =>
      opt.setName('team').setDescription('Team name or abbreviation to jab').setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData) {
      return interaction.editReply('❌ No league data loaded. Ask a commissioner to run `/loadweek`.');
    }

    const teamArg = interaction.options.getString('team');
    const team = findTeamByName(leagueData, teamArg);
    if (!team) return interaction.editReply(`❌ No team found matching **${teamArg}**.`);

    const teamLabel = `${team.region} ${team.name}`;

    // Live W/L this season
    const currentSeason = getCurrentSeason(leagueData);
    const seas = getLatestTeamSeason(team, currentSeason);
    const liveW = seas ? safeNumber(seas.won) : 0;
    const liveL = seas ? safeNumber(seas.lost) : 0;

    // Coach sheet lookup
    let coachInfo = null;
    let career    = null;
    let lastTitle = null;
    try {
      const [coachRows, resumeRows] = await Promise.all([
        fetchSheetCsv(COACH_SHEET_ID, COACH_SHEET_TAB),
        fetchSheetCsv(RESUME_SHEET_ID, RESUME_GID, true),
      ]);
      coachInfo = findCoachOnSheet(coachRows, getTeamName(team)) ||
                  findCoachOnSheet(coachRows, team.region) ||
                  findCoachOnSheet(coachRows, team.name);
      if (coachInfo) {
        career    = findCareerRecord(resumeRows, coachInfo.coach);
        lastTitle = lastNatTitleYear(coachInfo.coach);
      }
    } catch {
      // sheets best-effort; jab will fall back to live record
    }

    // Worst loss this season (largest negative margin)
    const sched = getTeamSchedule(leagueData, team.abbrev);
    let worstLoss = null;
    let lastLoss  = null;
    if (sched) {
      const losses = sched.games.filter((g) => g.result === 'L');
      if (losses.length) {
        lastLoss = losses[losses.length - 1];
        worstLoss = [...losses].sort(
          (a, b) => (a.teamScore - a.oppScore) - (b.teamScore - b.oppScore)
        )[0];
      }
    }

    // Build a list of plausible jabs based on facts we have.
    const jabs = [];

    if (liveW + liveL > 0) {
      const winPct = liveW / (liveW + liveL);
      if (winPct < 0.34) {
        jabs.push(
          `Look at the standings: **${teamLabel}** sitting at a beautiful **${liveW}-${liveL}**. Hard to recruit when the trophy case has a tumbleweed in it.`,
          `**${liveW}-${liveL}**? My grandma's bowling team has a better record, and she's been dead since 2042.`,
          `${teamLabel} is **${liveW}-${liveL}**. At this point even the kicker is in the transfer portal.`
        );
      } else if (winPct < 0.5) {
        jabs.push(
          `**${teamLabel}** is hovering at **${liveW}-${liveL}** — I've seen elevators with fewer ups and downs.`,
          `${teamLabel} fans showing up to **${liveW}-${liveL}** games like it's still rebuilding year 4.`
        );
      }
    }

    if (worstLoss && worstLoss.oppScore - worstLoss.teamScore >= 21) {
      jabs.push(
        `Don't forget Week ${worstLoss.week} — **${teamLabel}** got dropped **${worstLoss.oppScore}-${worstLoss.teamScore}** by ${worstLoss.opponentAbbrev}. Bring a coat next time, it gets cold getting blown out like that.`,
        `**${teamLabel}**'s game film has been classified by the Pentagon as cruel and unusual punishment after that ${worstLoss.oppScore}-${worstLoss.teamScore} loss to ${worstLoss.opponentAbbrev}.`
      );
    } else if (lastLoss) {
      jabs.push(
        `Funny how **${teamLabel}** lost to ${lastLoss.opponentAbbrev} (${lastLoss.teamScore}-${lastLoss.oppScore}) and the fanbase is still in copium recovery.`
      );
    }

    if (career) {
      const totalGames = career.wins + career.losses;
      const cpct = totalGames > 0 ? career.wins / totalGames : 0;
      if (cpct < 0.45 && totalGames >= 30) {
        jabs.push(
          `Career record check on the head coach: **${career.wins}-${career.losses}**. They've lost more games than my dog has bones — and the dog's been collecting since 2031.`
        );
      }
    }

    if (coachInfo) {
      if (coachInfo.natTitles === 0 && coachInfo.years >= 4) {
        jabs.push(
          `**${coachInfo.coach}** has been at it for ${coachInfo.years} seasons and the trophy case is still serving as overflow recycling. Zero natties.`
        );
      }
      if (lastTitle) {
        const drought = +currentSeason - +lastTitle;
        if (drought >= 6) {
          jabs.push(
            `**${coachInfo.coach}** hasn't won a natty since ${lastTitle}. That's ${drought} years of "we're back" press conferences and counting.`
          );
        }
      }
      if (coachInfo.playoffs === 0 && coachInfo.years >= 3) {
        jabs.push(
          `${coachInfo.years} seasons in and **${coachInfo.coach}** still hasn't sniffed the playoff. Bro is allergic to January football.`
        );
      }
    }

    // Always have a fallback so /trashtalk never fails
    jabs.push(
      `**${teamLabel}** is the kind of program where the marching band has more wins than the football team.`,
      `If **${teamLabel}** played football the way they recruit, they'd be a Sun Belt also-ran. Oh wait.`,
      `Heard **${teamLabel}** is installing a new offensive scheme: it's called *punting*.`
    );

    const jab = pick(jabs);

    const embed = new EmbedBuilder()
      .setTitle(`🔥 Trash Talk — ${teamLabel}`)
      .setColor(0xe74c3c)
      .setDescription(jab)
      .setFooter({ text: 'Light-hearted • all in good fun' })
      .setTimestamp();

    const logo = getTeamLogoUrl(team);
    if (logo) embed.setThumbnail(logo);

    return interaction.editReply({ embeds: [embed] });
  },
};
