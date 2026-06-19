// ============================================================
//  commands/standings.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getConferenceDivisionStandings,
  getConferenceLogoUrl,
  getConferenceAbbrev,
  formatRecord,
} = require('../utils/data');
const { getUserTeam } = require('../utils/userMap');
const {
  getRelevantConferenceGames,
  buildCurrentState,
  buildCurrentH2H,
  canStillWinDivision,
} = require('../utils/divisionRace');

function isEliminatedFromDivision(leagueData, divisionTeams, team) {
  if (!divisionTeams || divisionTeams.length === 0) return false;
  const divisionTeamTids = divisionTeams.map((entry) => entry.tid);
  const relevantGames = getRelevantConferenceGames(leagueData, divisionTeamTids);
  const state = buildCurrentState({ teams: divisionTeams });
  const h2hMap = buildCurrentH2H(leagueData, divisionTeamTids);
  return !canStillWinDivision(state, h2hMap, relevantGames, divisionTeamTids, team.tid);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('standings')
    .setDescription('Show conference standings split by division')
    .addStringOption((opt) =>
      opt
        .setName('conference')
        .setDescription('Conference abbreviation (defaults to your linked team conference)')
        .setRequired(false)
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

    let conference = interaction.options.getString('conference');
    if (!conference) {
      const userTeam = await getUserTeam(leagueData, interaction.user.id);
      if (!userTeam) {
        return interaction.editReply(
          '❌ No conference specified and no linked coach found. Pass a conference or run `/iam coach:<your name>` first.'
        );
      }

      conference = getConferenceAbbrev(leagueData, userTeam.cid);
      if (!conference) {
        return interaction.editReply(`❌ Could not determine the conference for **${userTeam.abbrev}**.`);
      }
    }

    const confStandings = getConferenceDivisionStandings(leagueData, conference);

    if (!confStandings) {
      return interaction.editReply(`❌ Could not find conference **${conference}** in the loaded file.`);
    }

    const conferenceLogo = getConferenceLogoUrl(leagueData, confStandings.conferenceAbbrev);

    const embeds = confStandings.divisions.map((division) => {
      const sortedTeams = division.teams;

      const lines = sortedTeams.map((team, index) => {
        const overall = formatRecord(team.wins, team.losses, team.ties);
        const confRec = formatRecord(team.confWins, team.confLosses, team.confTies);
        const divRec = formatRecord(team.divWins, team.divLosses, team.divTies);
        const crown = team.rank === 1 ? '👑 ' : '';

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
          text: 'Football GM export • Sorted by conference record, then head-to-head, then division record. Eliminated = cannot catch division leader.',
        });

      if (conferenceLogo) {
        embed.setThumbnail(conferenceLogo);
      }

      return embed;
    });

    return interaction.editReply({ embeds: embeds.slice(0, 10) });
  },
};
