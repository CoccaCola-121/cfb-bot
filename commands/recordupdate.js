// ============================================================
//  commands/recordupdate.js
//
//  Allow a coach (and only that coach, via /iam linking) to
//  manually overwrite their W/L for a specific year. Use cases:
//    • Took over a team mid-season (don't own the early losses)
//    • Left a team mid-season (don't own the late losses)
//    • Multiple half-seasons across different years
//
//  The override is applied on top of the resume sheet by
//  /coachstats and /coachleaderboard (career totals + per-year
//  history are recomputed from the override).
//
//  Usage:
//    /recordupdate                          – show your overrides
//    /recordupdate year:2058 wins:5 losses:3
//                                            – set/replace override
//    /recordupdate year:2058 clear:true     – remove that year
//    /recordupdate clear:true               – remove all overrides
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserCoachName } = require('../utils/userMap');
const {
  getOverridesForCoach,
  setCoachOverride,
  clearCoachOverride,
} = require('../utils/coachOverrides');

const MIN_YEAR = 1900;
const MAX_YEAR = 2200;
const MAX_GAMES_IN_YEAR = 30; // generous upper bound; sanity check

function fmtRecord(w, l, t) {
  return Number(t) > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function buildOverridesEmbed(coachName, overrides) {
  const lines = [...overrides.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([year, rec]) => `**${year}:** ${fmtRecord(rec.wins, rec.losses, rec.ties)}`);

  return new EmbedBuilder()
    .setTitle(`📝 Record Overrides — ${coachName}`)
    .setColor(0x9b59b6)
    .setDescription(
      lines.length
        ? lines.join('\n')
        : '_No record overrides set._\n\nUse `/recordupdate year:<year> wins:<n> losses:<n>` to add one.'
    )
    .setFooter({
      text: 'Overrides hard-overwrite the matching year in /coachstats and /coachleaderboard.',
    });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recordupdate')
    .setDescription('Manually adjust your W/L for a specific year (only affects your linked coach).')
    .addIntegerOption((opt) =>
      opt
        .setName('year')
        .setDescription('Season year to override, e.g. 2058')
        .setRequired(false)
        .setMinValue(MIN_YEAR)
        .setMaxValue(MAX_YEAR)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('wins')
        .setDescription('Wins for that year')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(MAX_GAMES_IN_YEAR)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('losses')
        .setDescription('Losses for that year')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(MAX_GAMES_IN_YEAR)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('ties')
        .setDescription('Ties for that year (optional, default 0)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(MAX_GAMES_IN_YEAR)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('clear')
        .setDescription('Remove the override for the given year (or all overrides if no year given).')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Always ephemeral — this is a personal config thing, not for the channel.
    await interaction.deferReply({ ephemeral: true });

    const coachName = getUserCoachName(interaction.user.id);
    if (!coachName) {
      return interaction.editReply(
        '❌ You haven\'t linked yourself to a coach yet.\n' +
          'Run `/iam coach:<your name>` first, then try `/recordupdate` again.'
      );
    }

    const year = interaction.options.getInteger('year');
    const wins = interaction.options.getInteger('wins');
    const losses = interaction.options.getInteger('losses');
    const ties = interaction.options.getInteger('ties') || 0;
    const clear = interaction.options.getBoolean('clear') || false;

    // Mode: clear
    if (clear) {
      if (year !== null && year !== undefined) {
        const removed = clearCoachOverride(coachName, year);
        if (!removed) {
          return interaction.editReply(
            `ℹ️ No override existed for **${coachName}** in **${year}**.`
          );
        }
        return interaction.editReply(
          `🧹 Removed your **${year}** record override (coach: **${coachName}**).`
        );
      }
      const removed = clearCoachOverride(coachName);
      if (!removed) {
        return interaction.editReply(
          `ℹ️ You have no record overrides to remove (coach: **${coachName}**).`
        );
      }
      return interaction.editReply(
        `🧹 Removed **all** of your record overrides (coach: **${coachName}**).`
      );
    }

    // Mode: show current
    if (year === null || year === undefined) {
      const overrides = getOverridesForCoach(coachName);
      const embed = buildOverridesEmbed(coachName, overrides);
      return interaction.editReply({ embeds: [embed] });
    }

    // Mode: set
    if (wins === null || wins === undefined || losses === null || losses === undefined) {
      return interaction.editReply(
        '❌ To set an override you must provide both `wins:` and `losses:` ' +
          '(plus `ties:` if applicable).\n' +
          'Example: `/recordupdate year:2058 wins:5 losses:3`'
      );
    }

    if (wins + losses + ties === 0) {
      // Treat 0/0/0 as "I want this season to count as nothing", which is
      // valid (e.g. you took over with 0 games left). Allow it.
    }

    const ok = setCoachOverride(
      coachName,
      year,
      wins,
      losses,
      ties,
      interaction.user.id
    );
    if (!ok) {
      return interaction.editReply(
        '❌ Failed to save your override. Check the bot logs.'
      );
    }

    const recStr = fmtRecord(wins, losses, ties);
    const embed = new EmbedBuilder()
      .setTitle(`✅ Record override saved — ${coachName}`)
      .setColor(0x2ecc71)
      .setDescription(
        `**${year}:** ${recStr}\n\n` +
          'This will hard-overwrite your stats for that year in `/coachstats` ' +
          'and adjust your career totals in `/coachleaderboard`. ' +
          'Run `/recordupdate` (no args) any time to see all your overrides, ' +
          `or \`/recordupdate year:${year} clear:true\` to remove this one.`
      );

    return interaction.editReply({ embeds: [embed] });
  },
};
