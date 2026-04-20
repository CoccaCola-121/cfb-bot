// ============================================================
//  commands/standings.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getConferenceDivisionStandings,
  getConferenceLogoUrl,
  formatRecord,
} = require('../utils/data');

function getTeamMetaMaps(leagueData) {
  const byTid = new Map();

  for (const team of leagueData.teams || []) {
    byTid.set(team.tid, {
      tid: team.tid,
      cid: team.cid,
      did: team.did,
      abbrev: team.abbrev,
      region: team.region,
      name: team.name,
      disabled: !!team.disabled,
    });
  }

  return { byTid };
}

function getFutureGames(leagueData) {
  const futureGames = [];

  if (Array.isArray(leagueData.schedule)) {
    for (const game of leagueData.schedule) {
      const homeTid =
        game.homeTid ??
        game.home?.tid ??
        game.teams?.[0]?.tid;

      const awayTid =
        game.awayTid ??
        game.away?.tid ??
        game.teams?.[1]?.tid;

      if (Number.isInteger(homeTid) && Number.isInteger(awayTid)) {
        futureGames.push({ homeTid, awayTid });
      }
    }
  }

  if (futureGames.length === 0 && Array.isArray(leagueData.games)) {
    for (const game of leagueData.games) {
      const teams = Array.isArray(game.teams) ? game.teams : null;
      if (!teams || teams.length < 2) continue;

      const homeTid = teams[0]?.tid;
      const awayTid = teams[1]?.tid;

      const played =
        typeof teams[0]?.pts === 'number' &&
        typeof teams[1]?.pts === 'number';

      if (!played && Number.isInteger(homeTid) && Number.isInteger(awayTid)) {
        futureGames.push({ homeTid, awayTid });
      }
    }
  }

  return futureGames;
}

function countRelevantRemainingGames(leagueData, teamTid) {
  const { byTid } = getTeamMetaMaps(leagueData);
  const futureGames = getFutureGames(leagueData);
  const teamMeta = byTid.get(teamTid);

  if (!teamMeta) {
    return { divRemaining: 0, confRemaining: 0 };
  }

  let divRemaining = 0;
  let confRemaining = 0;

  for (const game of futureGames) {
    const involvesTeam = game.homeTid === teamTid || game.awayTid === teamTid;
    if (!involvesTeam) continue;

    const oppTid = game.homeTid === teamTid ? game.awayTid : game.homeTid;
    const oppMeta = byTid.get(oppTid);
    if (!oppMeta || oppMeta.disabled) continue;

    const sameConference = oppMeta.cid === teamMeta.cid;
    const sameDivision = sameConference && oppMeta.did === teamMeta.did;

    if (sameConference) confRemaining += 1;
    if (sameDivision) divRemaining += 1;
  }

  return { divRemaining, confRemaining };
}

function recordPoints(wins = 0, losses = 0, ties = 0) {
  return wins + (ties * 0.5);
}

// Returns head-to-head record diff between teamA and teamB across completed games.
// Positive => teamA leads H2H, negative => teamB leads, 0 => tied or never played.
function getHeadToHeadDiff(leagueData, teamATid, teamBTid) {
  if (!Array.isArray(leagueData.games)) return 0;

  let aWins = 0;
  let bWins = 0;

  for (const game of leagueData.games) {
    const teams = Array.isArray(game.teams) ? game.teams : null;
    if (!teams || teams.length < 2) continue;

    const t0 = teams[0];
    const t1 = teams[1];

    // Only count completed games (both teams have a numeric pts value).
    if (typeof t0?.pts !== 'number' || typeof t1?.pts !== 'number') continue;

    const tids = [t0.tid, t1.tid];
    if (!tids.includes(teamATid) || !tids.includes(teamBTid)) continue;

    const aTeam = t0.tid === teamATid ? t0 : t1;
    const bTeam = t0.tid === teamBTid ? t0 : t1;

    if (aTeam.pts > bTeam.pts) aWins += 1;
    else if (bTeam.pts > aTeam.pts) bWins += 1;
  }

  return aWins - bWins;
}

// Sort order: conf record → div record → head-to-head → overall record.
function sortDivisionTeams(leagueData, teams) {
  return [...teams].sort((a, b) => {
    const aConfPts = recordPoints(a.confWins, a.confLosses, a.confTies);
    const bConfPts = recordPoints(b.confWins, b.confLosses, b.confTies);
    if (aConfPts !== bConfPts) return bConfPts - aConfPts;

    const aDivPts = recordPoints(a.divWins, a.divLosses, a.divTies);
    const bDivPts = recordPoints(b.divWins, b.divLosses, b.divTies);
    if (aDivPts !== bDivPts) return bDivPts - aDivPts;

    // Tied on both conf and div — use H2H if they've played.
    const h2h = getHeadToHeadDiff(leagueData, a.tid, b.tid);
    if (h2h !== 0) return -h2h; // more H2H wins comes first

    // Final fallback: overall record.
    const aTotalPts = recordPoints(a.wins, a.losses, a.ties);
    const bTotalPts = recordPoints(b.wins, b.losses, b.ties);
    return bTotalPts - aTotalPts;
  });
}

function isEliminatedFromDivision(leagueData, divisionTeams, team) {
  if (!divisionTeams || divisionTeams.length === 0) return false;

  const leader = divisionTeams[0];
  if (leader.abbrev === team.abbrev) return false;

  const leaderConfPts = recordPoints(leader.confWins, leader.confLosses, leader.confTies);
  const leaderDivPts = recordPoints(leader.divWins, leader.divLosses, leader.divTies);

  const remaining = countRelevantRemainingGames(leagueData, team.tid);

  const teamCurrentConfPts = recordPoints(team.confWins, team.confLosses, team.confTies);
  const teamCurrentDivPts = recordPoints(team.divWins, team.divLosses, team.divTies);

  const maxPossibleConfPts = teamCurrentConfPts + remaining.confRemaining;
  const maxPossibleDivPts = teamCurrentDivPts + remaining.divRemaining;

  // Primary criterion: conference record.
  if (maxPossibleConfPts < leaderConfPts) {
    return true;
  }

  // If they can at best tie the leader in conf record, they also need to catch
  // them in div record (since that's our secondary sort key).
  if (maxPossibleConfPts === leaderConfPts && maxPossibleDivPts < leaderDivPts) {
    return true;
  }

  return false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('standings')
    .setDescription('Show conference standings split by division')
    .addStringOption((opt) =>
      opt
        .setName('conference')
        .setDescription('Conference abbreviation')
        .setRequired(true)
        .addChoices(
          { name: 'ACC', value: 'ACC' },
          { name: 'B1G', value: 'B1G' },
          { name: 'B12', value: 'B12' },
          { name: 'P12', value: 'P12' },
          { name: 'SEC', value: 'SEC' },
          { name: 'MW', value: 'MW' },
          { name: 'MAC', value: 'MAC' },
          { name: 'C-USA', value: 'C-USA' },
          { name: 'AAC', value: 'AAC' },
          { name: 'SUN', value: 'SUN' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData) {
      return interaction.editReply('❌ No league data loaded. Ask a commissioner to run `/loadweek`.');
    }

    const conference = interaction.options.getString('conference');
    const confStandings = getConferenceDivisionStandings(leagueData, conference);

    if (!confStandings) {
      return interaction.editReply(`❌ Could not find conference **${conference}** in the loaded file.`);
    }

    const conferenceLogo = getConferenceLogoUrl(leagueData, confStandings.conferenceAbbrev);

    const embeds = confStandings.divisions.map((division) => {
      // Re-sort locally so display ordering matches our desired tiebreakers
      // regardless of how the upstream utility sorted the teams.
      const sortedTeams = sortDivisionTeams(leagueData, division.teams)
        .map((team, index) => ({ ...team, rank: index + 1 }));

      const lines = sortedTeams.map((team, index) => {
        const overall = formatRecord(team.wins, team.losses, team.ties);
        const confRec = formatRecord(team.confWins, team.confLosses, team.confTies);
        const divRec = formatRecord(team.divWins, team.divLosses, team.divTies);
        const crown = index === 0 ? '👑 ' : '';

        const eliminated = isEliminatedFromDivision(leagueData, sortedTeams, team);
        const eliminatedTag = eliminated ? '\n❌ **Eliminated from division contention**' : '';

        return (
          `\`${String(team.rank).padStart(2)}.\` ${crown}**${team.name}** (${team.abbrev})\n` +
          `Overall: **${overall}**  •  Conf: **${confRec}**  •  Div: **${divRec}**` +
          `${eliminatedTag}`
        );
      });

      const embed = new EmbedBuilder()
        .setTitle(`${confStandings.conferenceAbbrev} — ${division.divisionName}`)
        .setColor(0x2e86c1)
        .setDescription(lines.join('\n\n'))
        .setFooter({
          text: 'Sorted by conference record, then division record, then head-to-head. Eliminated = cannot catch division leader.',
        });

      if (conferenceLogo) {
        embed.setThumbnail(conferenceLogo);
      }

      return embed;
    });

    return interaction.editReply({ embeds: embeds.slice(0, 10) });
  },
};