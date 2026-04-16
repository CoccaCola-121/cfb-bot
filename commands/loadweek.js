const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);

// Change this only if your bot stores league data somewhere else
const SAVE_PATH = path.join(process.cwd(), 'data', 'weekData.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loadweek')
    .setDescription('Load week data from a JSON attachment')
    .addAttachmentOption(option =>
      option
        .setName('file')
        .setDescription('Upload a .json or .json.gz file')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      // Debug what Discord actually sent
      console.log('command:', interaction.commandName);
      console.log(
        'options:',
        JSON.stringify(
          interaction.options.data.map(o => ({
            name: o.name,
            type: o.type,
            value: o.value ?? null,
            attachmentName: o.attachment?.name ?? null,
            attachmentUrl: o.attachment?.url ?? null
          })),
          null,
          2
        )
      );

      // Required attachment getter
      const attachment = interaction.options.getAttachment('file', true);

      if (!attachment) {
        return interaction.editReply('❌ No file attachment was received.');
      }

      const rawBuffer = await downloadAttachment(attachment.url);
      const parsed = await parseJsonBuffer(rawBuffer);

      await fs.mkdir(path.dirname(SAVE_PATH), { recursive: true });
      await fs.writeFile(SAVE_PATH, JSON.stringify(parsed, null, 2), 'utf8');

      const summary = summarizeJson(parsed);

      return interaction.editReply(
        [
          `✅ Week data loaded successfully from **${attachment.name}**`,
          `**Saved to:** \`${SAVE_PATH}\``,
          `**Top-level type:** ${Array.isArray(parsed) ? 'array' : 'object'}`,
          summary ? `**Summary:** ${summary}` : null
        ].filter(Boolean).join('\n')
      );
    } catch (err) {
      console.error('[loadweek] failed:', err);
      return interaction.editReply(`❌ Failed to load week data: ${err.message}`);
    }
  }
};

async function downloadAttachment(url) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'NZCFLBot/1.0'
    }
  });

  if (!res.ok) {
    throw new Error(`attachment download failed: HTTP ${res.status} ${res.statusText}`);
  }

  const arr = await res.arrayBuffer();
  const buf = Buffer.from(arr);

  if (!buf.length) {
    throw new Error('attachment was empty');
  }

  return buf;
}

async function parseJsonBuffer(buf) {
  let text;

  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;

  if (isGzip) {
    text = (await gunzip(buf)).toString('utf8');
  } else {
    text = buf.toString('utf8');
  }

  text = text.replace(/^\uFEFF/, '').trim();

  if (!text) {
    throw new Error('decoded file is empty');
  }

  if (text.startsWith('<!DOCTYPE html') || text.startsWith('<html')) {
    throw new Error('got HTML instead of JSON');
  }

  if (text[0] !== '{' && text[0] !== '[') {
    throw new Error(`decoded file starts with "${text.slice(0, 20)}", not JSON`);
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON: ${err.message}`);
  }
}

function summarizeJson(data) {
  if (Array.isArray(data)) {
    return `array with ${data.length} item(s)`;
  }

  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    const preview = keys.slice(0, 8).join(', ');
    return keys.length
      ? `${keys.length} top-level key(s): ${preview}${keys.length > 8 ? ', ...' : ''}`
      : 'empty object';
  }

  return '';
}