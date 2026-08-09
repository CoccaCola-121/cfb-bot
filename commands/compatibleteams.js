const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLatestLeagueData, getTeamName, getTeamColor } = require('../utils/data');
const {
  loadCrootRankings,
  findRecruitByName,
  resolveRecruitingTeam,
  getFitForTeam,
  formatCommitStatus,
} = require('../utils/crootRankings');

const MAX_TEAMS = 120;
const MAX_RESULTS = 20;

function splitTeamList(raw) {
  return String(raw || '')
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function dedupeResolvedTeams(entries) {
  const seen = new Set();
  const teams = [];
  const unresolved = [];

  for (const entry of entries) {
    if (entry.team) {
      const key = String(entry.team.tid);
      if (seen.has(key)) continue;
      seen.add(key);
      teams.push(entry.team);
    } else {
      unresolved.push(entry.raw);
    }
  }

  return { teams, unresolved };
}

function formatRank(rank) {
  return rank ? `#${rank}` : 'Unranked';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compatibleteams')
    .setDescription('Rank a recruit’s best fits from a pasted team list')
    .addStringOption((opt) =>
      opt
        .setName('player')
        .setDescription('Recruit name')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('teams')
        .setDescription('Comma, semicolon, or newline-separated team names/abbrevs')
        .setRequired(true)
        .setMaxLength(4000)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData?.teams) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const playerArg = interaction.options.getString('player', true);
    const teamInputs = splitTeamList(interaction.options.getString('teams', true));

    if (!teamInputs.length) {
      return interaction.editReply('❌ Enter at least one team in `teams:`.');
    }

    if (teamInputs.length > MAX_TEAMS) {
      return interaction.editReply(`❌ Too many teams. Max is **${MAX_TEAMS}**.`);
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

    const recruit = findRecruitByName(recruits, playerArg);
    if (!recruit) {
      return interaction.editReply(`❌ No recruit found matching **${playerArg}**.`);
    }

    const resolved = teamInputs.map((raw) => ({
      raw,
      team: resolveRecruitingTeam(leagueData, raw),
    }));
    const { teams, unresolved } = dedupeResolvedTeams(resolved);

    if (!teams.length) {
      return interaction.editReply('❌ None of those teams matched active teams.');
    }

    const rankedTeams = teams
      .map((team) => ({
        team,
        fit: getFitForTeam(recruit, team),
      }))
      .filter((entry) => entry.fit)
      .sort((a, b) =>
        a.fit.fitRank - b.fit.fitRank ||
        getTeamName(a.team).localeCompare(getTeamName(b.team))
      )
      .slice(0, MAX_RESULTS);

    if (!rankedTeams.length) {
      return interaction.editReply(`No fit rankings found for **${recruit.name}** among those teams.`);
    }

    const lines = rankedTeams.map(({ team, fit }, index) => {
      return `\`${String(index + 1).padStart(2)}\` **${getTeamName(team)}** (${team.abbrev}) — Raw **#${fit.fitRank}**`;
    });

    const footerParts = [
      `${teams.length} resolved team${teams.length === 1 ? '' : 's'}`,
      unresolved.length ? `${unresolved.length} unresolved` : null,
      'Rankings tab',
    ].filter(Boolean);

    const embed = new EmbedBuilder()
      .setColor(getTeamColor(teams[0], 0x2b4b8c))
      .setTitle(`🧢 ${recruit.name} Team Fits`)
      .setDescription(lines.join('\n'))
      .addFields({
        name: 'Recruit',
        value: [
          `Overall: **${formatRank(recruit.rank)}**`,
          `Position: **${recruit.pos || '?'}**`,
          `Committed: **${formatCommitStatus(recruit.committed)}**`,
        ].join(' • '),
      })
      .setFooter({ text: footerParts.join(' • ') })
      .setTimestamp();

    if (unresolved.length) {
      embed.addFields({
        name: 'Unresolved',
        value: unresolved.slice(0, 12).join(', ').slice(0, 1020),
      });
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
