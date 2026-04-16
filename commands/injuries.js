// ============================================================
//  commands/injuries.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getLatestPosition,
  getTeamName,
} = require('../utils/data');

function findTeamByAbbrev(leagueData, abbrev) {
  const target = String(abbrev || '').toUpperCase().trim();
  return (leagueData.teams || []).find(
    (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === target
  );
}

function formatInjuryLength(gamesRemaining) {
  const games = Number(gamesRemaining ?? 0);
  if (games <= 0) return 'Day-to-day';
  if (games === 1) return '1 game';
  return `${games} games`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('injuries')
    .setDescription('Show current non-redshirt injuries for a team')
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation, e.g. MSU')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData || !leagueData.teams || !leagueData.players) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const abbrev = interaction.options.getString('team').toUpperCase().trim();
    const team = findTeamByAbbrev(leagueData, abbrev);

    if (!team) {
      return interaction.editReply(`❌ No active team found with abbreviation **${abbrev}**.`);
    }

    const injuredPlayers = (leagueData.players || [])
      .filter((player) => player.tid === team.tid)
      .map((player) => {
        const injury = player.injury || {};
        const type = String(injury.type || '').trim();
        const gamesRemaining = Number(injury.gamesRemaining ?? 0);

        if (!type) return null;
        if (type.toLowerCase() === 'redshirt') return null;
        if (gamesRemaining <= 0) return null;

        return {
          name: `${player.firstName || ''} ${player.lastName || ''}`.trim(),
          pos: getLatestPosition(player),
          injury: type,
          gamesRemaining,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.gamesRemaining !== a.gamesRemaining) return b.gamesRemaining - a.gamesRemaining;
        return a.name.localeCompare(b.name);
      });

    if (!injuredPlayers.length) {
      return interaction.editReply(`No current non-redshirt injuries for **${getTeamName(team)} (${team.abbrev})**.`);
    }

    const lines = injuredPlayers.map((p) =>
      `**${p.name}** (${p.pos}) — **${p.injury}** • ${formatInjuryLength(p.gamesRemaining)}`
    );

    const embed = new EmbedBuilder()
      .setTitle(`🩹 ${getTeamName(team)} (${team.abbrev}) Injuries`)
      .setColor(0xe67e22)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Current injuries only • Redshirts excluded' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};