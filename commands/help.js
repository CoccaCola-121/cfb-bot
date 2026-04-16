// ============================================================
//  commands/help.js
//  /help  —  Lists all commands and how to use them
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available bot commands'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🏈 NZCFL Bot — Commands')
      .setColor(0x2b4b8c)
      .setDescription('All commands for your 120-team college football league.')
      .addFields(
        {
          name: '📊 Stats & Standings',
          value: [
            '`/standings [conference]` — League standings (all or by conference)',
            '`/teamstats [team]` — Full stats for a team (use abbreviation or city)',
            '`/playerleaders [stat]` — Top players in passing, rushing, tackles, etc.',
            '`/scores [week]` — Game scores (latest week or specify a week number)',
          ].join('\n'),
        },
        {
          name: '🧢 Coach Stats',
          value: [
            '`/coachstats [name]` — Look up a coach\'s record from Google Sheets',
            '',
            'This reads your linked Google Sheet (tab: `CoachStats`).',
            'Columns: Coach | Team | W | L | Conf_W | Conf_L | Bowl | Notes',
          ].join('\n'),
        },
        {
          name: '📰 Reddit',
          value: [
            '`/redditnews [new|hot|top]` — Latest posts from the league subreddit',
          ].join('\n'),
        },
        {
          name: '⚙️ Data Management',
          value: [
            '`/loadweek [file or url] [label]` — **Commissioner only**',
            'Load a new football-gm JSON export after each weekly sim.',
            '',
            '**How to export from football-gm:**',
            '1. In your league, go to Tools → Export',
            '2. Choose "All data" and download the .json file',
            '3. Run `/loadweek` and attach that file',
            '4. All stat commands will update automatically',
          ].join('\n'),
        },
        {
          name: '📋 Setting up Google Sheets',
          value: [
            'Create a Sheet with a tab named `CoachStats`.',
            'Row 1 must be headers: `Coach | Team | W | L | Conf_W | Conf_L | Bowl | Notes`',
            'Make the sheet public (Viewer access) and add the Sheet ID to `.env`.',
          ].join('\n'),
        },
      )
      .setFooter({ text: 'CFB League Bot  •  Built with discord.js' });

    return interaction.reply({ embeds: [embed], ephemeral: false });
  },
};
