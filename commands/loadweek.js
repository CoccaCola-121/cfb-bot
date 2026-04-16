// ============================================================
//  commands/loadweek.js
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

function getDropboxCandidateUrls(inputUrl) {
  const urls = [];
  const seen = new Set();

  const add = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  add(inputUrl);

  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return urls;
  }

  const host = parsed.hostname.toLowerCase();
  const isDropbox =
    host === 'dropbox.com' ||
    host === 'www.dropbox.com' ||
    host === 'dl.dropbox.com' ||
    host === 'dl.dropboxusercontent.com';

  if (!isDropbox) {
    return urls;
  }

  // Variant 1: dl=1
  {
    const u = new URL(parsed.toString());
    u.searchParams.set('dl', '1');
    add(u.toString());
  }

  // Variant 2: raw=1
  {
    const u = new URL(parsed.toString());
    u.searchParams.delete('dl');
    u.searchParams.set('raw', '1');
    add(u.toString());
  }

  // Variant 3: switch to dl.dropboxusercontent.com with dl=1
  {
    const u = new URL(parsed.toString());
    u.hostname = 'dl.dropboxusercontent.com';
    u.searchParams.set('dl', '1');
    add(u.toString());
  }

  // Variant 4: switch to dl.dropboxusercontent.com with raw=1
  {
    const u = new URL(parsed.toString());
    u.hostname = 'dl.dropboxusercontent.com';
    u.searchParams.delete('dl');
    u.searchParams.set('raw', '1');
    add(u.toString());
  }

  return urls;
}

async function streamDownloadToFile(targetUrl, destinationPath, options = {}) {
  const {
    retries = 2,
    timeoutMs = 45000,
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

async function inspectFileStart(filePath) {
  const fh = await fsp.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await fh.read(buffer, 0, buffer.length, 0);
    const head = buffer.slice(0, bytesRead).toString('utf8');
    return head;
  } finally {
    await fh.close();
  }
}

async function validateJsonFileLight(filePath) {
  const head = (await inspectFileStart(filePath)).trimStart();

  if (head.startsWith('<!DOCTYPE html') || head.startsWith('<html') || head.includes('<head')) {
    throw new Error('Downloaded page was HTML, not the raw export file');
  }

  if (!head.startsWith('{')) {
    throw new Error('File does not appear to begin with a JSON object');
  }

  const hasVersion = head.includes('"version"');
  const hasMeta = head.includes('"meta"');
  const hasTeams = head.includes('"teams"');
  const hasPlayers = head.includes('"players"');

  if (!(hasVersion || hasMeta || hasTeams || hasPlayers)) {
    throw new Error('File did not look like a Football GM export');
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

async function tryAttachmentDownload(attachment, downloadedPath) {
  const candidates = [attachment?.url, attachment?.proxyURL].filter(Boolean);
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    try {
      const result = await streamDownloadToFile(url, downloadedPath, {
        retries: 2,
        timeoutMs: 45000,
        label: i === 0 ? 'attachment download' : 'attachment proxy download',
      });
      return result;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('No valid attachment URL found');
}

async function tryUrlDownload(rawUrl, downloadedPath) {
  const candidates = getDropboxCandidateUrls(rawUrl);
  let lastError = null;
  let finalUrl = rawUrl;

  for (const url of candidates) {
    try {
      const result = await streamDownloadToFile(url, downloadedPath, {
        retries: 2,
        timeoutMs: 45000,
        label: 'URL download',
      });
      finalUrl = url;
      return { ...result, finalUrl };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('URL download failed');
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
        '❌ Please attach a `.json` / `.json.gz` file or provide a URL.'
      );
    }

    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cfb-bot-'));
    const downloadedPath = path.join(tempDir, 'downloaded.bin');
    const processedJsonPath = path.join(tempDir, 'processed.json');

    let sourceDesc = '';

    try {
      if (attachment) {
        const lowerName = String(attachment.name || '').toLowerCase();

        if (!looksLikeSupportedFilename(lowerName)) {
          return interaction.editReply('❌ File must be a `.json`, `.json.gz`, or `.gz` file.');
        }

        const { contentType } = await tryAttachmentDownload(attachment, downloadedPath);

        if (isGzipByNameOrType(lowerName, contentType)) {
          await gunzipFileToFile(downloadedPath, processedJsonPath);
        } else {
          await fsp.copyFile(downloadedPath, processedJsonPath);
        }

        sourceDesc = `📎 ${attachment.name}`;
      } else {
        const { contentType, finalUrl } = await tryUrlDownload(rawUrl, downloadedPath);

        if (isGzipByNameOrType(finalUrl, contentType)) {
          await gunzipFileToFile(downloadedPath, processedJsonPath);
        } else {
          await fsp.copyFile(downloadedPath, processedJsonPath);
        }

        sourceDesc = `🔗 URL`;
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
        .setDescription('The export was downloaded, processed, and saved.')
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