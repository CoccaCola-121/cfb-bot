const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const zlib = require('zlib');
const { saveLeagueData, getStandings } = require('../utils/data');

// Helper: download a URL and return raw JSON text, decompressing .gz if needed
async function downloadJsonText(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  // Detect gzip by filename OR by magic bytes (1f 8b)
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
    .setDescription('Load a new football-gm JSON export (commissioner only)')
    .addAttachmentOption(opt =>
      opt.setName('jsonfile')
         .setDescription('Attach the .json or .json.gz file exported from football-gm')
         .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('url')
         .setDescription('Or paste a direct URL to the raw JSON / JSON.GZ file')
         .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('label')
         .setDescription('Label for this save, e.g. "Week8" (optional)')
         .setRequired(false)
    ),

  async execute(interaction) {
    const requiredRole = process.env.ADMIN_ROLE;
    if (requiredRole) {
      const hasRole = interaction.member?.roles.cache.some(r => r.name === requiredRole);
      if (!hasRole) {
        return interaction.reply({
          content: `❌ Only users with the **${requiredRole}** role can load league data.`,
          ephemeral: true,
        });
      }
    }

    await interaction.deferReply();

    const attachment = interaction.options.getAttachment('jsonfile');
    const url        = interaction.options.getString('url');
    const label      = interaction.options.getString('label') || `week_${Date.now()}`;

    if (!attachment && !url) {
      return interaction.editReply(
        '❌ Please attach a .json / .json.gz file **or** provide a URL.'
      );
    }

    let jsonText;
    let sourceDesc;

    try {
      if (attachment) {
        const name = attachment.name.toLowerCase();
        if (!name.endsWith('.json') && !name.endsWith('.json.gz') && !name.endsWith('.gz')) {
          return interaction.editReply('❌ File must be `.json` or `.json.gz`.');
        }
        jsonText   = await downloadJsonText(attachment.url, attachment.name);
        sourceDesc = `📎 ${attachment.name}`;
      } else {
        jsonText   = await downloadJsonText(url, url);
        sourceDesc = `🔗 URL`;
      }
    } catch (err) {
      return interaction.editReply(`❌ Failed to download/decompress the file: ${err.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return interaction.editReply("❌ That file isn't valid JSON. Make sure you exported from football-gm correctly.");
    }

    if (!parsed.teams || !Array.isArray(parsed.teams)) {
      return interaction.editReply(
        '⚠️ JSON loaded but doesn\'t look like a football-gm export (no `teams` array found).\n' +
        'It was saved anyway — use `/standings` to verify.'
      );
    }

    let savedFile;
    try {
      savedFile = saveLeagueData(jsonText, label);
    } catch (err) {
      return interaction.editReply(`❌ Failed to save the data: ${err.message}`);
    }

    const standings = getStandings(parsed);
    const leader    = standings[0];

    const embed = new EmbedBuilder()
      .setTitle('✅ League data loaded!')
      .setColor(0x2ecc71)
      .addFields(
        { name: '📂 Source',   value: sourceDesc,                       inline: true  },
        { name: '💾 Saved as', value: savedFile,                        inline: true  },
        { name: '🏫 Teams',    value: `${parsed.teams.length} teams`,   inline: true  },
        { name: '👥 Players',  value: `${(parsed.players || []).length} players`, inline: true },
        { name: '📅 Season',   value: String(parsed.startingSeason ?? parsed.season ?? '?'), inline: true },
        { name: '🏆 Current leader', value: leader ? `${leader.name} (${leader.wins}-${leader.losses})` : '—', inline: true },
      )
      .setDescription('Commands updated with new data:\n`/standings` `/teamstats` `/playerleaders` `/scores`')
      .setFooter({ text: `Loaded by ${interaction.user.username}` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};