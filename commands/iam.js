// ============================================================
//  commands/iam.js
//  /iam coach:<name>           → link your Discord ID to a coach
//  /iam clear:true             → remove your link
//  /iam                        → show your current link + team
//
//  The mapping is keyed by *coach name* (not team), so when a
//  coach moves to a new program their default team updates
//  automatically via the Coach Google Sheet.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getUserCoachName,
  setUserCoach,
  clearUserCoach,
  loadCoachIndex,
  resolveCoachToTeam,
} = require('../utils/userMap');
const { getLatestLeagueData, getTeamName, getTeamLogoUrl } = require('../utils/data');
const { normalize } = require('../utils/sheets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('iam')
    .setDescription('Link your Discord account to a coach so commands default to your team')
    .addStringOption((opt) =>
      opt
        .setName('coach')
        .setDescription('Your coach name (as it appears on the league Coach sheet)')
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('clear')
        .setDescription('Remove your current link')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    const wantsClear = interaction.options.getBoolean('clear') === true;
    const coachInput = (interaction.options.getString('coach') || '').trim();

    // ── Clear ────────────────────────────────────────────────
    if (wantsClear) {
      const had = !!getUserCoachName(userId);
      clearUserCoach(userId);
      return interaction.editReply(
        had
          ? '✅ Cleared your coach link. Commands will no longer default to a team for you.'
          : 'ℹ️ You did not have a coach link set.'
      );
    }

    // ── Show current ─────────────────────────────────────────
    if (!coachInput) {
      const current = getUserCoachName(userId);
      if (!current) {
        return interaction.editReply(
          'ℹ️ You are not linked to a coach yet.\n' +
            'Run `/iam coach:<your coach name>` to link, or `/iam clear:true` to clear.'
        );
      }

      const leagueData = getLatestLeagueData();
      const team = leagueData
        ? await resolveCoachToTeam(leagueData, current)
        : null;

      const teamLine = team
        ? `Currently coaching: **${getTeamName(team)}**`
        : '_(No active team found for this coach in the latest league data.)_';

      const embed = new EmbedBuilder()
        .setTitle('🪪 Your Coach Link')
        .setColor(0x2b4b8c)
        .setDescription(`Linked coach: **${current}**\n${teamLine}`)
        .setFooter({
          text: 'Use /iam coach:<name> to change, /iam clear:true to remove.',
        });

      if (team) {
        const logo = getTeamLogoUrl(team);
        if (logo) embed.setThumbnail(logo);
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // ── Set / change link ────────────────────────────────────
    let index;
    try {
      index = await loadCoachIndex({ force: true });
    } catch (err) {
      // Save anyway — the user might be onboarding before the
      // sheet is updated. They'll just see a warning.
      setUserCoach(userId, coachInput);
      return interaction.editReply(
        `⚠️ Saved your link to **${coachInput}**, but the league Coach sheet ` +
          `couldn't be checked: ${err.message}`
      );
    }

    const entry = index.get(normalize(coachInput));

    // Resolve actual coach name + team for nicer confirmation.
    const resolvedName = entry?.coach || coachInput;
    setUserCoach(userId, resolvedName);

    const leagueData = getLatestLeagueData();
    const team = leagueData
      ? await resolveCoachToTeam(leagueData, resolvedName)
      : null;

    if (!entry) {
      return interaction.editReply(
        `⚠️ Saved your link to **${coachInput}**, but I couldn't find that coach ` +
          `on the league Coach sheet. Double-check the spelling or wait for the ` +
          `sheet to be updated. Defaults will start working as soon as the sheet ` +
          `lists you.`
      );
    }

    const teamLine = team
      ? `You are now defaulted to **${getTeamName(team)}**.`
      : `_(No active Football GM team currently matches "${entry.team}". ` +
        `Defaults will resolve once league data and the sheet line up.)_`;

    const embed = new EmbedBuilder()
      .setTitle('✅ Coach Linked')
      .setColor(0x27ae60)
      .setDescription(
        `Discord user <@${userId}> → **${resolvedName}**\n${teamLine}`
      )
      .addFields({
        name: 'What this does',
        value:
          'Most commands (e.g. `/boxscore`, `/teamstats`, `/teamschedule`, ' +
          '`/coachstats`, `/injuries`, `/recruitingclass`, `/rankingstats`) ' +
          'will now default to your team if you call them without arguments. ' +
          'You can still pass a team to override.',
      })
      .setFooter({
        text:
          'When you change teams, no need to update — the bot follows the Coach sheet.',
      });

    if (team) {
      const logo = getTeamLogoUrl(team);
      if (logo) embed.setThumbnail(logo);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
