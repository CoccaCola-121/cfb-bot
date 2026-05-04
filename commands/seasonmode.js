// ============================================================
//  commands/seasonmode.js
//
//  Admin command for flipping the bot between live / offseason
//  data sources. See utils/seasonMode.js for resolution rules.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getSeasonMode,
  getRawMode,
  setSeasonMode,
  getModeStatus,
} = require('../utils/seasonMode');
const { getLatestLeagueData } = require('../utils/data');
const { requireBotAdmin } = require('../utils/permissions');

const MODE_CHOICES = [
  { name: 'live (current-season data from FGM export)', value: 'live' },
  { name: 'offseason (data from sheets)', value: 'offseason' },
  { name: 'auto (decide from FGM phase)', value: 'auto' },
];

function describeMode(mode) {
  switch (mode) {
    case 'live':
      return 'pulling current-season data from the latest Football GM export';
    case 'offseason':
      return 'pulling stats from the league sheets (FGM export ignored for current-season views)';
    case 'auto':
      return 'auto — decided per-call from the FGM phase in the export';
    default:
      return mode;
  }
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toUTCString();
  } catch {
    return iso;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('seasonmode')
    .setDescription('Inspect or change the bot season-data source (admin only)')
    .addSubcommand((sc) =>
      sc
        .setName('status')
        .setDescription('Show the current resolved season mode and where it came from')
    )
    .addSubcommand((sc) =>
      sc
        .setName('set')
        .setDescription('Set the bot season mode')
        .addStringOption((opt) =>
          opt
            .setName('mode')
            .setDescription('Which mode to switch to')
            .setRequired(true)
            .addChoices(...MODE_CHOICES)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      if (!(await requireBotAdmin(interaction, 'change season mode'))) return;

      const requested = interaction.options.getString('mode');

      try {
        const writtenAt = setSeasonMode(requested, interaction.user.tag);
        const leagueData = getLatestLeagueData();
        const status = getModeStatus(leagueData);

        const envOverride = status.envValue
          ? `\n⚠️ Env var \`NZCFL_SEASON_MODE=${status.envValue}\` is set and overrides the saved mode. Unset the env var or change it to take effect from the saved mode.`
          : '';

        const embed = new EmbedBuilder()
          .setTitle('🛠️ Season mode updated')
          .setColor(0x2ecc71)
          .addFields(
            { name: 'Saved mode', value: `**${requested}**`, inline: true },
            { name: 'Resolved mode', value: `**${status.resolved}**`, inline: true },
            {
              name: 'Behavior',
              value: describeMode(requested) + envOverride,
              inline: false,
            },
            {
              name: 'Saved at',
              value: fmtDate(writtenAt.setAt),
              inline: true,
            },
            {
              name: 'Saved by',
              value: writtenAt.setBy || '—',
              inline: true,
            }
          )
          .setTimestamp();

        return interaction.reply({ embeds: [embed] });
      } catch (err) {
        return interaction.reply({
          content: `❌ ${err.message}`,
          ephemeral: true,
        });
      }
    }

    if (sub === 'status') {
      // Status is read-only — anyone can see it; no admin gate.
      const leagueData = getLatestLeagueData();
      const status = getModeStatus(leagueData);

      const phaseLine =
        status.phase === null
          ? '*(no league data loaded)*'
          : `\`${status.phase}\` → implies **${status.phaseImpliesMode}**`;

      const sourceLines = [];
      if (status.envValue) {
        sourceLines.push(`• Env override: \`NZCFL_SEASON_MODE=${status.envValue}\``);
      }
      if (status.stateFileMode) {
        sourceLines.push(
          `• State file: **${status.stateFileMode}** (set ${fmtDate(status.stateSetAt)}` +
            (status.stateSetBy ? ` by ${status.stateSetBy}` : '') +
            ')'
        );
      }
      if (!sourceLines.length) {
        sourceLines.push('• Default: **live**');
      }

      const embed = new EmbedBuilder()
        .setTitle('📊 Season mode status')
        .setColor(0x3498db)
        .addFields(
          { name: 'Resolved mode', value: `**${status.resolved}**`, inline: true },
          { name: 'Configured (raw)', value: `**${status.raw}**`, inline: true },
          { name: 'FGM phase', value: phaseLine, inline: false },
          { name: 'Source precedence', value: sourceLines.join('\n'), inline: false },
          {
            name: 'Behavior',
            value: describeMode(getRawMode()),
            inline: false,
          }
        )
        .setFooter({ text: status.statePath })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
  },
};
