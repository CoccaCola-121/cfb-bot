// ============================================================
//  commands/recruitingclass.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData, getTeamName } = require('../utils/data');
const { getRecruitingInfo } = require('../utils/recruiting');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recruitingclass')
    .setDescription('Show recruit IDs committed to a team')
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation, e.g. MSU')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData || !leagueData.teams) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const abbrev = interaction.options.getString('team').toUpperCase().trim();
    const team = leagueData.teams.find(
      (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === abbrev
    );

    if (!team) {
      return interaction.editReply(`❌ No active team found with abbreviation **${abbrev}**.`);
    }

    const info = await getRecruitingInfo({
      schoolName: team.region,
      abbrev: team.abbrev,
    }).catch(() => null);

    if (!info) {
      return interaction.editReply(`❌ No recruiting class data found for **${abbrev}**.`);
    }

    const recruitText = info.recruitIds.length
      ? info.recruitIds.map((id) => `#${id}`).join(', ')
      : 'No commits listed.';

    const summaryBits = [
      `247 Score: **${info.classScore?.toFixed?.(3) ?? '?'}**`,
      `Commits: **${info.recruitCount ?? 0}**`,
      `Rank: **${info.rank ?? '?'}**`,
    ];

    if (info.bestRecruit !== null) {
      summaryBits.push(`Best Croot: **#${info.bestRecruit}**`);
    }

    if (info.averageRecruit !== null) {
      summaryBits.push(`Avg Croot: **${info.averageRecruit.toFixed(1)}**`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`🧢 ${getTeamName(team)} (${team.abbrev}) Recruiting Class`)
      .setColor(0x8e44ad)
      .addFields(
        {
          name: 'Class Summary',
          value: summaryBits.join('  •  '),
          inline: false,
        },
        {
          name: 'Recruit IDs',
          value: recruitText,
          inline: false,
        }
      )
      .setFooter({ text: 'Recruit IDs from linked 247 sheet' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};