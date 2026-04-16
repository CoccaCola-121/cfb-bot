// ============================================================
//  commands/teamleaderboards.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData, getTeamLeaderboards } = require('../utils/data');

const CATEGORY_MAP = {
  passing_offense: { label: 'Passing Offense', emoji: '🎯', suffix: 'yds/gm' },
  rushing_offense: { label: 'Rushing Offense', emoji: '🏃', suffix: 'yds/gm' },
  total_offense: { label: 'Total Offense', emoji: '📦', suffix: 'yds/gm' },
  scoring_offense: { label: 'Scoring Offense', emoji: '🔥', suffix: 'pts/gm' },

  passing_defense: { label: 'Passing Defense', emoji: '🛡️', suffix: 'yds/gm allowed' },
  rushing_defense: { label: 'Rushing Defense', emoji: '🧱', suffix: 'yds/gm allowed' },
  total_defense: { label: 'Total Defense', emoji: '🚫', suffix: 'yds/gm allowed' },
  scoring_defense: { label: 'Scoring Defense', emoji: '❄️', suffix: 'pts/gm allowed' },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('teamleaderboards')
    .setDescription('Show top 10 team stat leaderboards')
    .addStringOption((opt) =>
      opt
        .setName('stat')
        .setDescription('Team leaderboard category')
        .setRequired(true)
        .addChoices(
          { name: 'Passing Offense', value: 'passing_offense' },
          { name: 'Rushing Offense', value: 'rushing_offense' },
          { name: 'Total Offense', value: 'total_offense' },
          { name: 'Scoring Offense', value: 'scoring_offense' },
          { name: 'Passing Defense', value: 'passing_defense' },
          { name: 'Rushing Defense', value: 'rushing_defense' },
          { name: 'Total Defense', value: 'total_defense' },
          { name: 'Scoring Defense', value: 'scoring_defense' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const stat = interaction.options.getString('stat');
    const meta = CATEGORY_MAP[stat];

    if (!meta) {
      return interaction.editReply('❌ Unknown leaderboard category.');
    }

    const rows = getTeamLeaderboards(leagueData, stat, 10);

    if (!rows.length) {
      return interaction.editReply(`No team data found for **${meta.label}**.`);
    }

    const lines = rows.map((row) =>
      `\`${String(row.rank).padStart(2)}.\` **${row.team}** (${row.abbrev}) — **${row.value.toFixed(1)} ${meta.suffix}**`
    );

    const embed = new EmbedBuilder()
      .setTitle(`${meta.emoji} ${meta.label} Leaders`)
      .setColor(0xf39c12)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Top 10 team leaderboard from latest Football GM export' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};