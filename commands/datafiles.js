// ============================================================
//  commands/datafiles.js
//
//  Admin-only diagnostic command. Shows:
//    • League export files currently on disk (newest first)
//    • Disk usage + retention setting (MAX_SAVED_FILES)
//    • In-memory sheet cache state (TTL, keys, hit status)
//
//  Useful for "did /loadweek actually take?" or "why is my
//  /coachstats data stale?" questions without SSH'ing into the box.
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  DATA_DIR,
  MAX_SAVED_FILES,
  listLeagueFiles,
  getLatestLeagueData,
  getCurrentSeason,
} = require('../utils/data');
const { sheetCacheStats, DEFAULT_TTL_MS } = require('../utils/sheetCache');

function fmtBytes(b) {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

function fmtAge(ms) {
  if (ms <= 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('datafiles')
    .setDescription('Show stored league files + cache state (commissioner only)'),

  async execute(interaction) {
    const requiredRole = process.env.ADMIN_ROLE;
    if (requiredRole) {
      const hasRole = interaction.member?.roles?.cache?.some((r) => r.name === requiredRole);
      if (!hasRole) {
        return interaction.reply({
          content: `❌ Only users with the **${requiredRole}** role can view data files.`,
          ephemeral: true,
        });
      }
    }

    await interaction.deferReply({ ephemeral: true });

    const files = listLeagueFiles();
    const now = Date.now();

    const fileLines = files.length
      ? files.map((f, i) => {
          const star = i === 0 ? '⭐ ' : '   ';
          return `${star}\`${f.name}\` — ${fmtBytes(f.size)} — ${fmtAge(now - f.time)}`;
        })
      : ['*(no league files on disk — run `/loadweek`)*'];

    // Active league snapshot info
    const league = getLatestLeagueData();
    let snapshotLine = '*(no data loaded)*';
    if (league) {
      const season = getCurrentSeason(league);
      const teamCt = (league.teams || []).filter((t) => !t.disabled).length;
      const gameCt = Array.isArray(league.games) ? league.games.length : 0;
      snapshotLine = `Season **${season}** • **${teamCt}** active teams • **${gameCt}** games`;
    }

    // Sheet cache summary
    const stats = sheetCacheStats();
    const cacheLines = stats.length
      ? stats.map((s) => {
          const ttl = s.expiresInMs > 0 ? `${Math.ceil(s.expiresInMs / 1000)}s left` : 'expired';
          const flag = s.inflight ? ' ⏳' : '';
          return `• ${s.cached ? '✅' : '❌'} \`${s.key}\` — ${s.rows} rows — ${ttl}${flag}`;
        })
      : ['*(sheet cache empty)*'];

    const embed = new EmbedBuilder()
      .setTitle('📂 Data Files & Cache')
      .setColor(0x4b6584)
      .addFields(
        { name: 'Storage', value: `\`${DATA_DIR}\`\nKeep newest **${MAX_SAVED_FILES}** files`, inline: false },
        { name: `Saved League Files (${files.length})`, value: fileLines.join('\n').slice(0, 1020) || '—', inline: false },
        { name: 'Loaded Snapshot', value: snapshotLine, inline: false },
        {
          name: `Sheet Cache (TTL ${Math.round(DEFAULT_TTL_MS / 1000)}s)`,
          value: cacheLines.join('\n').slice(0, 1020) || '—',
          inline: false,
        }
      )
      .setFooter({ text: 'Files marked ⭐ are the active snapshot' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
