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
//  This version is optimized to avoid high memory usage:
//  - download to temp file via streams
//  - gunzip via streams
//  - lightweight validation only
//  - save to data/ without parsing full JSON in memory
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

  parsed.searchParams.set('dl', '1');
  parsed.searchParams.delete('raw');

  if (
    host === 'www.dropbox.com' ||
    host === 'dropbox.com' ||
    host === 'dl.dropbox.com'
  ) {
    parsed.hostname = 'dl.dropboxusercontent.com';
  }

  return parsed.toString();
}

function looksLikeSupportedFilename(name) {
  const lower = String(name || '').toLowerCase();
  return lower.endsWith('.json') || lower.endsWith('.json.gz') || lower.endsWith('.gz');
}

function isGzipByNameOrType(name = '', contentType = '') {
  const lowerName = String(name || '').toLowerCase();
  const lowerType = String(contentType || '').toLowerCase();

  return lowerName.endsWith('.gz') || lowerType.includes('gzip');
}

function sanitizeLabel(label) {
  return String(label || Date.now()).replace(/[^\w-]+/g, '_');
}

function makeSavedFilename(label) {
  return `league_${sanitizeLabel(label)}.json`;
}

function toNodeReadable(webStream) {
  if (!webStream) {
    throw new Error('Response body stream was missing');
  }
  return Readable.fromWeb(webStream);
}

async function streamDownloadToFile(targetUrl, destinationPath, options = {}) {
  const {
    retries = 3,
    timeoutMs = 30000,
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

      await pipeline(
        toNodeReadable(res.body),
        fs.createWriteStream(destinationPath)
      );

      clearTimeout(timeout);

      const stat = await fsp.stat(destinationPath);
      if (!stat.size || stat.size <= 0) {
        throw new Error('Downloaded file was empty');
      }

      return {
        sizeBytes: stat.size,
        contentType: res.headers.get('content-type') || '',
      };
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;

      try {
        await fsp.unlink(destinationPath);
      } catch {}

      if (attempt < retries) {
        await sleep(500 * attempt);
      }
    }
  }

  throw new Error(`${label} failed after ${retries} attempt(s): ${lastError.message}`);
}

async function gunzipFileToFile(sourcePath, destinationPath) {
  await pipeline(
    fs.createReadStream(sourcePath),
    zlib.createGunzip(),
    fs.createWriteStream(destinationPath)
  );

  const stat = await fsp.stat(destinationPath);
  if (!stat.size || stat.size <= 0) {
    throw new Error('Decompressed file was empty');
  }

  return stat.size;
}

async function validateJsonFileLight(filePath) {
  // Read only the first chunk and check that it looks like a Football GM export
  const fh = await fsp.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await fh.read(buffer, 0, buffer.length, 0);
    const head = buffer.slice(0, bytesRead).toString('utf8').trimStart();

    if (!head.startsWith('{')) {
      throw new Error('File does not appear to begin with a JSON object');
    }

    const hasVersion = head.includes('"version"');
    const hasMeta = head.includes('"meta"');
    const hasTeams = head.includes('"teams"');
    const hasPlayers = head.includes('"players"');

    if (!(hasTeams || hasPlayers || hasVersion || hasMeta)) {
      throw new Error('File did not look like a Football GM export');
    }
  } finally {
    await fh.close();
  }
}

async function copyFileIntoData(sourcePath, label) {
  const filename = makeSavedFilename(label);
  const destinationPath = path.join(DATA_DIR, filename);
  await fsp.copyFile(sourcePath, destinationPath);
  return filename;
}

async function removeIfExists(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch {}
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
        .setDescription('Label for this save, e.g. Week8 (optional)')
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

    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cfb-bot-'));
    const downloadedPath = path.join(tempDir, 'downloaded.bin');
    const processedJsonPath = path.join(tempDir, 'processed.json');

    let sourceDesc = '';
    let normalizedUrl = rawUrl;

    try {
      if (attachment) {
        const lowerName = String(attachment.name || '').toLowerCase();

        if (!looksLikeSupportedFilename(lowerName)) {
          return interaction.editReply('❌ File must be a `.json`, `.json.gz`, or `.gz` file.');
        }

        const downloadUrl = attachment.proxyURL || attachment.url;
        const { contentType } = await streamDownloadToFile(downloadUrl, downloadedPath, {
          retries: 3,
          timeoutMs: 45000,
          label: 'attachment download',
        });

        if (isGzipByNameOrType(lowerName, contentType)) {
          await gunzipFileToFile(downloadedPath, processedJsonPath);
        } else {
          await fsp.copyFile(downloadedPath, processedJsonPath);
        }

        sourceDesc = `📎 ${attachment.name}`;
      } else {
        normalizedUrl = normalizeDropboxUrl(rawUrl);

        const { contentType } = await streamDownloadToFile(normalizedUrl, downloadedPath, {
          retries: 3,
          timeoutMs: 45000,
          label: 'URL download',
        });

        if (isGzipByNameOrType(normalizedUrl, contentType)) {
          await gunzipFileToFile(downloadedPath, processedJsonPath);
        } else {
          await fsp.copyFile(downloadedPath, processedJsonPath);
        }

        sourceDesc =
          normalizedUrl === rawUrl
            ? '🔗 URL'
            : '🔗 URL (Dropbox normalized)';
      }

      await validateJsonFileLight(processedJsonPath);

      const savedFile = await copyFileIntoData(processedJsonPath, label);

      const embed = new EmbedBuilder()
        .setTitle('✅ League data loaded!')
        .setColor(0x2ecc71)
        .addFields(
          { name: '📂 Source', value: sourceDesc, inline: true },
          { name: '💾 Saved as', value: savedFile, inline: true },
          { name: '🏈 Status', value: 'Ready to use', inline: true }
        )
        .setDescription(
          'The export was downloaded, processed, and saved.\n' +
          'Commands should now read from the newly loaded file.'
        )
        .setFooter({ text: `Loaded by ${interaction.user.username}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply(`❌ Failed to load week data: ${err.message}`);
    } finally {
      await removeIfExists(downloadedPath);
      await removeIfExists(processedJsonPath);
      try {
        await fsp.rmdir(tempDir);
      } catch {}
    }
  },
};