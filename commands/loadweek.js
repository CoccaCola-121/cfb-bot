// loadweek.js
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);

// Change this if your bot stores league data somewhere else.
const SAVE_PATH = path.join(process.cwd(), 'data', 'weekData.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loadweek')
    .setDescription('Load week data from a JSON attachment, pasted JSON, or URL.')
    .addAttachmentOption(option =>
      option
        .setName('file')
        .setDescription('Upload a .json or .json.gz file')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('json')
        .setDescription('Paste raw JSON directly')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('url')
        .setDescription('Direct URL to a .json or .json.gz file')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

    try {
      const attachment = interaction.options.getAttachment('file');
      const pastedJson = interaction.options.getString('json');
      const urlInput = interaction.options.getString('url');

      const providedCount = [attachment, pastedJson, urlInput].filter(Boolean).length;
      if (providedCount === 0) {
        return interaction.editReply(
          '❌ Provide one source: a JSON attachment, pasted JSON, or a URL.'
        );
      }

      if (providedCount > 1) {
        return interaction.editReply(
          '❌ Provide only one source at a time: attachment, pasted JSON, or URL.'
        );
      }

      let rawBuffer;
      let sourceLabel = '';

      if (attachment) {
        rawBuffer = await downloadWithRetries(attachment.url, 3);
        sourceLabel = `attachment: ${attachment.name || 'uploaded file'}`;
      } else if (pastedJson) {
        rawBuffer = Buffer.from(stripCodeFences(pastedJson), 'utf8');
        sourceLabel = 'pasted JSON';
      } else if (urlInput) {
        const normalizedUrl = normalizeUrl(urlInput);
        rawBuffer = await downloadWithRetries(normalizedUrl, 3);
        sourceLabel = `url: ${normalizedUrl}`;
      }

      const { parsed, normalizedText, detectedFormat } = await parseJsonFromUnknownInput(rawBuffer);

      await fs.mkdir(path.dirname(SAVE_PATH), { recursive: true });
      await fs.writeFile(SAVE_PATH, normalizedText, 'utf8');

      const summary = summarizeJson(parsed);

      return interaction.editReply(
        [
          '✅ Week data loaded successfully.',
          `**Source:** ${sourceLabel}`,
          `**Format detected:** ${detectedFormat}`,
          `**Saved to:** \`${SAVE_PATH}\``,
          `**Top-level type:** ${Array.isArray(parsed) ? 'array' : 'object'}`,
          summary ? `**Summary:** ${summary}` : null
        ].filter(Boolean).join('\n')
      );
    } catch (err) {
      console.error('[loadweek] failed:', err);

      return interaction.editReply(
        `❌ Failed to load week data: ${err.message}`
      );
    }
  }
};

async function downloadWithRetries(url, attempts = 3) {
  let lastErr;

  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'NZCFLBot/1.0'
        }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);

      if (!buf || buf.length === 0) {
        throw new Error('downloaded file is empty');
      }

      return buf;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(`attachment/url download failed after ${attempts} attempt(s): ${lastErr.message}`);
}

async function parseJsonFromUnknownInput(buf) {
  if (!Buffer.isBuffer(buf)) {
    throw new Error('internal error: expected buffer input');
  }

  const trimmedBinaryPrefix = buf.subarray(0, Math.min(buf.length, 8));

  let text;
  let detectedFormat = 'plain json';

  // Gzip magic bytes: 1F 8B
  const looksGzipped =
    trimmedBinaryPrefix.length >= 2 &&
    trimmedBinaryPrefix[0] === 0x1f &&
    trimmedBinaryPrefix[1] === 0x8b;

  if (looksGzipped) {
    const unzipped = await gunzip(buf);
    text = unzipped.toString('utf8');
    detectedFormat = 'gzip-compressed json';
  } else {
    text = buf.toString('utf8');
  }

  text = stripBom(text).trim();

  if (!text) {
    throw new Error('file is empty after decoding');
  }

  // Catch obvious HTML preview pages early.
  const lowerStart = text.slice(0, 250).toLowerCase();
  if (
    lowerStart.startsWith('<!doctype html') ||
    lowerStart.startsWith('<html') ||
    lowerStart.includes('<head') ||
    lowerStart.includes('<body')
  ) {
    throw new Error('downloaded content is HTML, not raw JSON');
  }

  // Accept either object or array.
  const first = text[0];
  if (first !== '{' && first !== '[') {
    throw new Error('decoded content does not begin with a JSON object or array');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON: ${err.message}`);
  }

  const normalizedText = JSON.stringify(parsed, null, 2);
  return { parsed, normalizedText, detectedFormat };
}

function stripBom(str) {
  return str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
}

function stripCodeFences(str) {
  let s = str.trim();

  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '');
    s = s.replace(/\s*```$/, '');
  }

  return s.trim();
}

function normalizeUrl(input) {
  const raw = input.trim();

  // Rewrite common Dropbox shared links to force download.
  // Dropbox documents dl=1 for forcing download on shared links.
  if (raw.includes('dropbox.com')) {
    try {
      const u = new URL(raw);

      if (!u.searchParams.has('dl')) {
        u.searchParams.set('dl', '1');
      } else if (u.searchParams.get('dl') === '0') {
        u.searchParams.set('dl', '1');
      }

      return u.toString();
    } catch {
      return raw.replace('dl=0', 'dl=1');
    }
  }

  return raw;
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