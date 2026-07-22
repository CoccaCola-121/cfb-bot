const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData, getTeamName, getTeamLogoUrl, getTeamColor } = require('../utils/data');
const { getUserTeam } = require('../utils/userMap');
const {
  normalizePos,
  loadCrootRankings,
  resolveRecruitingTeam,
  getFitForTeam,
} = require('../utils/crootRankings');

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compatiblecroots')
    .setDescription('Show the current recruits who fit a team best')
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation or name (defaults to your linked team)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('position')
        .setDescription('Optional position group')
        .setRequired(false)
        .addChoices(...POSITIONS.map((pos) => ({ name: pos, value: pos })))
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const teamArg = interaction.options.getString('team');
    const position = normalizePos(interaction.options.getString('position') || '');

    let team = null;
    if (teamArg) {
      team = resolveRecruitingTeam(leagueData, teamArg);
      if (!team) {
        return interaction.editReply(`❌ No active team found for **${teamArg}**.`);
      }
    } else {
      team = await getUserTeam(leagueData, interaction.user.id);
      if (!team) {
        return interaction.editReply(
          '❌ No team specified and no linked coach found. Pass a team or run `/iam coach:<your name>` first.'
        );
      }
    }

    let recruits;
    try {
      ({ recruits } = await loadCrootRankings());
    } catch (err) {
      return interaction.editReply(`❌ Failed to load recruit rankings: ${err.message}`);
    }

    if (!recruits.length) {
      return interaction.editReply('❌ No recruit rankings found on the Rankings tab.');
    }

    const rankedFits = recruits
      .filter((recruit) => !recruit.committed)
      .filter((recruit) => !position || recruit.pos === position)
      .map((recruit) => ({
        recruit,
        fit: getFitForTeam(recruit, team),
      }))
      .filter((entry) => entry.fit)
      .sort((a, b) => {
        if (a.fit.fitRank !== b.fit.fitRank) return a.fit.fitRank - b.fit.fitRank;
        return (a.recruit.rank || Infinity) - (b.recruit.rank || Infinity);
      })
      .slice(0, 15);

    if (!rankedFits.length) {
      return interaction.editReply(
        `No uncommitted ${position || ''}${position ? ' ' : ''}recruits found for **${team.abbrev}**.`
      );
    }

    const lines = rankedFits.map(({ recruit, fit }, index) => {
      const overall = recruit.rank ? `#${recruit.rank}` : 'Unranked';
      return `\`${String(index + 1).padStart(2)}\` **${recruit.name}** (${recruit.pos}) — Raw **#${fit.fitRank}** • ${overall}`;
    });

    const title = position
      ? `🧢 ${getTeamName(team)} ${position} Fits`
      : `🧢 ${getTeamName(team)} Recruit Fits`;

    const embed = new EmbedBuilder()
      .setColor(getTeamColor(team, 0x2b4b8c))
      .setTitle(title)
      .setDescription(lines.join('\n'))
      .setThumbnail(getTeamLogoUrl(team))
      .setFooter({ text: 'Rankings tab • Uncommitted recruits only' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
