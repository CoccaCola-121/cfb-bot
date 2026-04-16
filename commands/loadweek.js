// ============================================================
//  commands/loadweek.js
//  /loadweek
//
//  Supports:
//    1. Attached .json export
//    2. Attached .json.gz export
//    3. URL to raw .json or .json.gz
//    4. Dropbox shared/direct links
//
//  Only users with the role defined in ADMIN_ROLE (.env) can run this.
//  If ADMIN_ROLE is not set, anyone can run it.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const zlib = require('zlib');
const { saveLeagueData, getStandings } = require('../utils/data');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeDropboxUrl(inputUrl) {
  let parsed;

  try {
    parsed = new URL(inputUrl);
  } catch {
    return inputUrl;
  }

  const host = parsed.hostname.toLowerCase();

  const isDropbox =
    host === 'dropbox.com' ||
    host === 'www.dropbox.com' ||
    host === 'dl.dropbox.com' ||
    host === 'dl.dropboxusercontent.com';

  if (!isDropbox) {
    return inputUrl;
  }

  // Force direct download behavior
  parsed.searchParams.set('dl', '1');
  parsed.searchParams.delete('raw');

  // Standardize common hosts where possible
  if (host === 'www.dropbox.com' || host === 'dropbox.com') {
    parsed.hostname = 'dl.dropboxusercontent.com';
  } else if (host === 'dl.dropbox.com') {
    parsed.hostname = 'dl.dropboxusercontent.com';
  }

  return parsed.toString();
}

async function fetchBufferWithRetry(targetUrl, options = {}) {
  const {
    retries = 3,
    timeoutMs = 25000,
    label = 'download',
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'cfb-bot/1.0',
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (!buffer.length) {
        throw new Error('Downloaded file was empty');
      }

      clearTimeout(timeout);
      return buffer;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;

      if (attempt < retries) {
        await sleep(500 * attempt);
      }
    }
  }

  throw new Error(`${label} failed after ${retries} attempt(s): ${lastError.message}`);
}

async function downloadAttachmentBuffer(attachment) {
  const urlsToTry = [];

  if (attachment?.url) {
    urlsToTry.push({ url: attachment.url, label: 'attachment.url' });
  }

  if (attachment?.proxyURL && attachment.proxyURL !== attachment.url) {
    urlsToTry.push({ url: attachment.proxyURL, label: 'attachment.proxyURL' });
  }

  let lastError;

  for (const candidate of urlsToTry) {
    try {
      return await fetchBufferWithRetry(candidate.url, {
        retries: 3,
        timeoutMs: 25000,
        label: candidate.label,
      });
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('No valid attachment URL found');
}

function maybeGunzip(buffer, filename = '', contentType = '') {
  const lowerName = String(filename || '').toLowerCase();
  const lowerType = String(contentType || '').toLowerCase();

  const looksGzip =
    lowerName.endsWith('.gz') ||
    lowerType.includes('gzip') ||
    (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b);

  if (!looksGzip) {
    return buffer.toString('utf8');
  }

  try {
    return zlib.gunzipSync(buffer).toString('utf8');
  } catch (err) {
    throw new Error(`Failed to decompress gzip file: ${err.message}`);
  }
}

function looksLikeSupportedFilename(name) {
  const lower = String(name || '').toLowerCase();
  return lower.endsWith('.json') || lower.endsWith('.json.gz');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loadweek')
    .setDescription('Load a new football-gm JSON export (commissioner only)')
    .addAttachmentOption((opt) =>
      opt
        .setName('jsonfile')
        .setDescription('Attach the .json or .json.gz export from football-gm')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('url')
        .setDescription('Or paste a direct URL / Dropbox link to the export')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('label')
        .setDescription('Label for this save, e.g. "Week8" (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const requiredRole = process.env.ADMIN_ROLE;

    if (requiredRole) {
      const hasRole = interaction.member?.roles?.cache?.some(
        (r) => r.name === requiredRole
      );

      if (!hasRole) {
        return interaction.reply({
          content: `❌ Only users with the **${requiredRole}** role can load league data.`,
          ephemeral: true,
        });
      }
    }

    await interaction.deferReply();

    const attachment = interaction.options.getAttachment('jsonfile');
    const rawUrl = interaction.options.getString('url');
    const label = interaction.options.getString('label') || `week_${Date.now()}`;

    if (!attachment && !rawUrl) {
      return interaction.editReply(
        '❌ Please attach a `.json` / `.json.gz` file or provide a URL.\n' +
        'Example: `/loadweek jsonfile:[attach file]`\n' +
        'Or: `/loadweek url:https://yourlink.com/export.json.gz`'
      );
    }

    let jsonText;
    let sourceDesc;

    try {
      if (attachment) {
        if (!looksLikeSupportedFilename(attachment.name)) {
          return interaction.editReply('❌ File must be a `.json` or `.json.gz` file.');
        }

        const fileBuffer = await downloadAttachmentBuffer(attachment);
        jsonText = maybeGunzip(fileBuffer, attachment.name, attachment.contentType);
        sourceDesc = `📎 ${attachment.name}`;
      } else {
        const normalizedUrl = normalizeDropboxUrl(rawUrl);
        const fileBuffer = await fetchBufferWithRetry(normalizedUrl, {
          retries: 3,
          timeoutMs: 30000,
          label: 'URL download',
        });

        jsonText = maybeGunzip(fileBuffer, normalizedUrl, '');
        sourceDesc =
          normalizedUrl === rawUrl
            ? '🔗 URL'
            : `🔗 URL (Dropbox normalized)`;
      }
    } catch (err) {
      return interaction.editReply(`❌ Failed to download the file: ${err.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return interaction.editReply(
        '❌ The file downloaded successfully, but it did not parse as JSON after processing.'
      );
    }

    if (!parsed.teams || !Array.isArray(parsed.teams)) {
      return interaction.editReply(
        '⚠️ JSON loaded but does not look like a football-gm export (no `teams` array found).\n' +
        'It was not saved.'
      );
    }

    let savedFile;
    try {
      savedFile = saveLeagueData(jsonText, label);
    } catch (err) {
      return interaction.editReply(`❌ Failed to save the data: ${err.message}`);
    }

    const standings = getStandings(parsed);
    const leader = standings[0];

    const embed = new EmbedBuilder()
      .setTitle('✅ League data loaded!')
      .setColor(0x2ecc71)
      .addFields(
        { name: '📂 Source', value: sourceDesc, inline: true },
        { name: '💾 Saved as', value: savedFile, inline: true },
        { name: '🏫 Teams', value: `${parsed.teams.length} teams`, inline: true },
        {
          name: '👥 Players',
          value: `${(parsed.players || []).length} players`,
          inline: true,
        },
        {
          name: '📅 Season',
          value: String(parsed.startingSeason ?? parsed.season ?? '?'),
          inline: true,
        },
        {
          name: '🏆 Current leader',
          value: leader ? `${leader.name} (${leader.wins}-${leader.losses})` : '—',
          inline: true,
        }
      )
      .setDescription(
        'Commands updated with new data:\n' +
        '`/standings` `/teamstats` `/playerleaders` `/scores`'
      )
      .setFooter({ text: `Loaded by ${interaction.user.username}` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};