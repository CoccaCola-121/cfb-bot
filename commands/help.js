// ============================================================
//  commands/help.js  —  UPDATED with all new commands
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
            '`/standings <conference>` — Conference standings split by division',
            '`/teamstats <team>` — Full stats, offense/defense ranks + recruiting snapshot',
            '`/teamleaderboards <stat>` — Top 10 team stat leaderboards',
            '`/teamschedule <team>` — Full schedule and results',
            '`/playerleaders <stat>` — Top 10 players in any stat category',
            '`/playerpage <player>` — Full player profile, ratings, and stats',
            '`/scores [week]` — Game scores (latest week or specify)',
            '`/boxscore <team> [week]` — **NEW** Single-game box score with stat leaders',
            '`/compareteams <team1> <team2>` — Side-by-side team comparison',
            '`/injuries <team>` — Current injuries and redshirts',
          ].join('\n'),
        },
        {
          name: '🧢 Coach Tools',
          value: [
            '`/coachstats <name>` — Coach resume with career record, titles, history',
            '`/coachleaderboard [sort]` — Top coaches by formula, wins, win%, conf titles, or rings',
            '`/contractwatch` — **NEW** Coaches available + schools without a listed coach',
            '`/openpositions [conference]` — **NEW** Ranks open coaching jobs by attractiveness',
          ].join('\n'),
        },
        {
          name: '🧢 Recruiting',
          value: [
            '`/recruitingclass <team>` — Upcoming recruiting class with 247 ranks',
            '`/recruitingleaders [position]` — **NEW** Top recruits by position + commitments',
          ].join('\n'),
        },
        {
          name: '📅 Schedule & Rankings',
          value: [
            '`/ooc <team> [year]` — Out-of-conference schedule *(fixed double-count bug)*',
            '`/rankhistory <team>` — **NEW** Season-long AP poll ranking history',
            '`/valueboard [conference]` — **NEW** Team value rankings',
          ].join('\n'),
        },
        {
          name: '📰 News',
          value: [
            '`/redditnews [new|hot|top]` — Latest posts from the league subreddit',
          ].join('\n'),
        },
        {
          name: '⚙️ Data Management (Mod Only)',
          value: [
            '`/loadweek [file or url] [label]` — Load a new Football-GM JSON export',
          ].join('\n'),
        },
      )
      .setFooter({ text: 'NZCFL Bot  •  Built with discord.js' });

    return interaction.reply({ embeds: [embed], ephemeral: false });
  },
};
