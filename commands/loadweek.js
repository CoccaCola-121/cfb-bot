const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const zlib = require('zlib');
const { saveLeagueData } = require('../utils/data');
const { invalidateSheetCache } = require('../utils/sheetCache');
const { requireBotAdmin } = require('../utils/permissions');

async function downloadJsonText(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());

  const isGzipped =
    (filename && filename.toLowerCase().endsWith('.gz')) ||
    (buffer[0] === 0x1f && buffer[1] === 0x8b);

  if (isGzipped) {
    return zlib.gunzipSync(buffer).toString('utf8');
  }

  return buffer.toString('utf8');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loadweek')
    .setDescription('Load a new football-gm JSON export, admin only')
    .addAttachmentOption((opt) =>
      opt
        .setName('jsonfile')
        .setDescription('Attach the .json or .json.gz file exported from football-gm')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('url')
        .setDescription('Or paste a direct URL to the raw JSON / JSON.GZ file')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('label')
        .setDescription('Label for this save, e.g. Week8')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!(await requireBotAdmin(interaction, 'load league data'))) return;

    await interaction.deferReply();

    const attachment = interaction.options.getAttachment('jsonfile');
    const url = interaction.options.getString('url');
    const label = interaction.options.getString('label') || `week_${Date.now()}`;

    if (!attachment && !url) {
      return interaction.editReply('❌ Please attach a .json / .json.gz file or provide a URL.');
    }

    let jsonText;
    let sourceDesc;

    try {
      if (attachment) {
        const name = attachment.name.toLowerCase();

        if (!name.endsWith('.json') && !name.endsWith('.json.gz') && !name.endsWith('.gz')) {
          return interaction.editReply('❌ File must be `.json` or `.json.gz`.');
        }

        jsonText = await downloadJsonText(attachment.url, attachment.name);
        sourceDesc = `📎 ${attachment.name}`;
      } else {
        jsonText = await downloadJsonText(url, url);
        sourceDesc = '🔗 URL';
      }
    } catch (err) {
      return interaction.editReply(`❌ Failed to download/decompress the file: ${err.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return interaction.editReply(
        "❌ That file isn't valid JSON. Make sure you exported from football-gm correctly."
      );
    }

    if (!parsed || !Array.isArray(parsed.teams)) {
      return interaction.editReply(
        '❌ This does not look like a valid football-gm export. No `teams` array found.'
      );
    }

    let savedFile;
    try {
      savedFile = saveLeagueData(jsonText, label);
    } catch (err) {
      return interaction.editReply(`❌ Failed to save the data: ${err.message}`);
    }

    invalidateSheetCache();

    const embed = new EmbedBuilder()
      .setTitle('✅ League data loaded')
      .setColor(0x2ecc71)
      .addFields(
        { name: '📂 Source', value: sourceDesc, inline: true },
        { name: '💾 Saved as', value: savedFile, inline: true }
      )
      .setFooter({ text: `Loaded by ${interaction.user.username}` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};