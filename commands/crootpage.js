const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData } = require('../utils/data');
const {
  loadCrootRankings,
  loadCrootValues,
  findRecruitByName,
  findCrootValuesByName,
  formatCommitStatus,
} = require('../utils/crootRankings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crootpage')
    .setDescription('Show one recruit and their best school fits')
    .addStringOption((opt) =>
      opt
        .setName('player')
        .setDescription('Recruit name')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const player = interaction.options.getString('player', true);

    let recruits;
    let crootValues;
    try {
      [{ recruits }, crootValues] = await Promise.all([
        loadCrootRankings(),
        loadCrootValues(),
      ]);
    } catch (err) {
      return interaction.editReply(`❌ Failed to load recruit rankings: ${err.message}`);
    }

    if (!recruits.length) {
      return interaction.editReply('❌ No recruit rankings found on the Rankings tab.');
    }

    const recruit = findRecruitByName(recruits, player);
    if (!recruit) {
      return interaction.editReply(`❌ No recruit found matching **${player}**.`);
    }

    const topFits = recruit.fits
      .slice(0, 8)
      .map((fit) => `**#${fit.fitRank}** ${fit.school}`);
    const valueProfile = findCrootValuesByName(crootValues, recruit.name);
    const topValues = (valueProfile?.values || [])
      .slice(0, 3)
      .map((value) => value.label);

    const embed = new EmbedBuilder()
      .setColor(0x2b4b8c)
      .setTitle(`⭐ ${recruit.name}`)
      .setDescription(
        [
          recruit.rank ? `Overall: **#${recruit.rank}**` : 'Overall: **Unranked**',
          `Position: **${recruit.pos || '?'}**`,
          `Committed: **${formatCommitStatus(recruit.committed)}**`,
        ].join(' • ')
      )
      .addFields(
        {
          name: 'Top Values',
          value: topValues.length ? topValues.join('\n') : '—',
        },
        {
          name: 'Best Fits',
          value: topFits.length ? topFits.join('\n') : '—',
        }
      )
      .setFooter({ text: 'Rankings tab' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
