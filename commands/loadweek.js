const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const zlib = require('zlib');
const { saveLeagueData } = require('../utils/data');
const { invalidateSheetCache } = require('../utils/sheetCache');
const { requireBotAdmin } = require('../utils/permissions');

const NZCFL_EXPORT_CHANNEL_ID = process.env.NZCFL_EXPORT_CHANNEL_ID || '585595755192909824';
const RECENT_EXPORT_MESSAGE_LIMIT = 50;
const EXPORT_URL_REGEX = /https?:\/\/\S+/gi;

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

function isSupportedExportFilename(filename = '') {
  const lower = filename.toLowerCase();
  return lower.endsWith('.json') || lower.endsWith('.json.gz') || lower.endsWith('.gz');
}

function findExportUrlInMessage(message) {
  const attachment = message.attachments.find((item) => isSupportedExportFilename(item.name));
  if (attachment) {
    return {
      url: attachment.url,
      sourceDesc: `📎 ${attachment.name}`,
    };
  }

  const contentUrls = message.content.match(EXPORT_URL_REGEX) || [];
  for (const candidate of contentUrls) {
    const lower = candidate.toLowerCase();
    if (lower.includes('.json') || lower.includes('.gz')) {
      return {
        url: candidate,
        sourceDesc: '🔗 URL from export channel message',
      };
    }
  }

  for (const embed of message.embeds) {
    const candidate = embed.url || embed.data?.url;
    if (!candidate) continue;

    const lower = candidate.toLowerCase();
    if (lower.includes('.json') || lower.includes('.gz')) {
      return {
        url: candidate,
        sourceDesc: '🔗 URL embed from export channel message',
      };
    }
  }

  return null;
}

async function findLatestExportFromChannel(interaction) {
  const channel = await interaction.guild.channels.fetch(NZCFL_EXPORT_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Export channel ${NZCFL_EXPORT_CHANNEL_ID} is missing or not text-based.`);
  }

  const messages = await channel.messages.fetch({ limit: RECENT_EXPORT_MESSAGE_LIMIT });
  for (const message of messages.values()) {
    const found = findExportUrlInMessage(message);
    if (found) return found;
  }

  throw new Error(
    `No recent .json, .json.gz, or .gz export found in <#${NZCFL_EXPORT_CHANNEL_ID}>.`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loadweek')
    .setDescription('Load a football-gm export from a file, URL, or the latest export-channel post')
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

    let jsonText;
    let sourceDesc;

    try {
      if (attachment) {
        const name = attachment.name.toLowerCase();

        if (!isSupportedExportFilename(name)) {
          return interaction.editReply('❌ File must be `.json` or `.json.gz`.');
        }

        jsonText = await downloadJsonText(attachment.url, attachment.name);
        sourceDesc = `📎 ${attachment.name}`;
      } else if (url) {
        jsonText = await downloadJsonText(url, url);
        sourceDesc = '🔗 URL';
      } else {
        const latestExport = await findLatestExportFromChannel(interaction);
        jsonText = await downloadJsonText(latestExport.url, latestExport.url);
        sourceDesc = `${latestExport.sourceDesc} from <#${NZCFL_EXPORT_CHANNEL_ID}>`;
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
