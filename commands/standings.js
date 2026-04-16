// ============================================================
//  commands/standings.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData, getConferenceDivisionStandings, formatRecord } = require('../utils/data');

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

    const embeds = confStandings.divisions.map((division) => {
      const lines = division.teams.map((team, index) => {
        const overall = formatRecord(team.wins, team.losses, team.ties);
        const confRec = formatRecord(team.confWins, team.confLosses, team.confTies);
        const divRec = formatRecord(team.divWins, team.divLosses, team.divTies);
        const crown = index === 0 ? '👑 ' : '';

        return (
          `\`${String(team.rank).padStart(2)}.\` ${crown}**${team.name}** (${team.abbrev})\n` +
          `Overall: **${overall}**  •  Conf: **${confRec}**  •  Div: **${divRec}**`
        );
      });

      return new EmbedBuilder()
        .setTitle(`${confStandings.conferenceAbbrev} — ${division.divisionName}`)
        .setColor(0x2e86c1)
        .setDescription(lines.join('\n\n'))
        .setFooter({
          text: 'Sorted by conference record, then division record, then head-to-head',
        });
    });

    return interaction.editReply({ embeds: embeds.slice(0, 10) });
  },
};