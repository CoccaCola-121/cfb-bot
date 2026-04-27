// ============================================================
//  commands/teamschedule.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData, getTeamSchedule } = require('../utils/data');
const { getUserTeam } = require('../utils/userMap');
const { getWeekLabel } = require('../utils/weekLabels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('teamschedule')
    .setDescription('Show a team schedule with scores')
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation, e.g. MSU (defaults to your linked team if you ran /iam)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const teamArg = interaction.options.getString('team');
    let abbrev = null;

    if (teamArg) {
      abbrev = teamArg.toUpperCase().trim();
    } else {
      const userTeam = await getUserTeam(leagueData, interaction.user.id);
      if (!userTeam) {
        return interaction.editReply(
          '❌ No team specified and no linked coach found. ' +
            'Pass a team (e.g. `team: MSU`) or run `/iam coach:<your name>` first.'
        );
      }
      abbrev = String(userTeam.abbrev || '').toUpperCase().trim();
    }

    const result = getTeamSchedule(leagueData, abbrev);

    if (!result) {
      return interaction.editReply(`❌ No active team found with abbreviation **${abbrev}**.`);
    }

    if (result.games.length === 0) {
      return interaction.editReply(`No games found for **${result.team.abbrev}**.`);
    }

    const lines = result.games.map((g) => {
      return `**${getWeekLabel(g.week)}** — ${g.result} vs **${g.opponentAbbrev}** (${g.teamScore}-${g.oppScore})`;
    });

    const chunkSize = 20;
    const chunks = [];
    for (let i = 0; i < lines.length; i += chunkSize) {
      chunks.push(lines.slice(i, i + chunkSize));
    }

    const embeds = chunks.map((chunk, idx) =>
      new EmbedBuilder()
        .setTitle(
          idx === 0
            ? `📅 ${result.team.region} ${result.team.name} (${result.team.abbrev}) Schedule`
            : `${result.team.abbrev} Schedule — continued`
        )
        .setColor(0x5865f2)
        .setDescription(chunk.join('\n'))
        .setFooter({ text: `Season ${result.season}` })
    );

    return interaction.editReply({ embeds: embeds.slice(0, 10) });
  },
};
