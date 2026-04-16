// ============================================================
//  commands/coachstats.js
//  /coachstats [name]
//  Reads from Google Sheets tab "CoachStats"
//  Expected columns: Coach | Team | W | L | Pct | Conf_W | Conf_L | Bowl | Notes
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getSheetData, rowsToObjects } = require('../utils/data');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coachstats')
    .setDescription('Look up a coach\'s record and stats')
    .addStringOption(opt =>
      opt.setName('name')
         .setDescription('Coach name or partial name (e.g. "Smith" or "John")')
         .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    let rows;
    try {
      // Reads the "CoachStats" tab — adjust tab name if yours differs
      rows = await getSheetData('CoachStats!A:Z');
    } catch (err) {
      console.error('Sheets error:', err);
      return interaction.editReply(`❌ Could not read Google Sheets: ${err.message}`);
    }

    const coaches = rowsToObjects(rows);
    if (coaches.length === 0) {
      return interaction.editReply('❌ The CoachStats sheet appears empty or has no header row.');
    }

    const query = interaction.options.getString('name').toLowerCase();

    // Search the Coach column (case-insensitive, partial match)
    const matches = coaches.filter(c =>
      (c.Coach || '').toLowerCase().includes(query) ||
      (c.Team  || '').toLowerCase().includes(query)
    );

    if (matches.length === 0) {
      return interaction.editReply(`❌ No coach found matching **${query}**.`);
    }

    if (matches.length > 5) {
      const names = matches.slice(0, 10).map(c => `• ${c.Coach} (${c.Team})`).join('\n');
      return interaction.editReply(
        `Found ${matches.length} coaches. Be more specific, or here are some matches:\n${names}`
      );
    }

    // Build an embed for each match (up to 5)
    const embeds = matches.slice(0, 5).map(coach => {
      const win  = parseInt(coach.W   || 0);
      const loss = parseInt(coach.L   || 0);
      const pct  = win + loss > 0 ? (win / (win + loss)).toFixed(3) : '—';

      const fields = [
        { name: '🏫 Team',    value: coach.Team    || '—', inline: true  },
        { name: '📊 Record',  value: `${win}-${loss} (${pct})`, inline: true },
        { name: '🏟️ Conf',   value: coach.Conf_W && coach.Conf_L ? `${coach.Conf_W}-${coach.Conf_L}` : '—', inline: true },
        { name: '🏆 Bowls',   value: coach.Bowl    || '—', inline: true  },
      ];

      // Add any extra columns from the sheet dynamically
      const knownKeys = ['Coach', 'Team', 'W', 'L', 'Pct', 'Conf_W', 'Conf_L', 'Bowl', 'Notes'];
      const extras = Object.entries(coach)
        .filter(([k]) => !knownKeys.includes(k) && coach[k])
        .slice(0, 4);
      for (const [k, v] of extras) {
        fields.push({ name: k, value: String(v), inline: true });
      }

      if (coach.Notes) {
        fields.push({ name: '📝 Notes', value: coach.Notes, inline: false });
      }

      return new EmbedBuilder()
        .setTitle(`🧢 Coach ${coach.Coach}`)
        .setColor(0x2b4b8c)
        .addFields(fields)
        .setFooter({ text: 'Stats from Google Sheets • /coachstats [name]' });
    });

    return interaction.editReply({ embeds });
  },
};
