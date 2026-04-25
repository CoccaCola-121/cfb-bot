// ============================================================
//  commands/help.js
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
          name: '🪪 Personalize',
          value: [
            '`/iam coach:<your name>` — Link your Discord ID to your coach so commands default to your team',
            '`/iam` — Show your current link',
            '`/iam clear:true` — Remove your link',
            '_Once linked, most team/coach commands work without arguments and follow you when you change teams._',
          ].join('\n'),
        },
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
            '`/boxscore <team> [week]` — Single-game box score with stat leaders',
            '`/compareteams <team1> <team2>` — Side-by-side team comparison',
            '`/injuries <team>` — Current injuries and redshirts',
            '`/confoverview <conference>` — Conference-wide team stats summary',
            '`/heismanwatch` — Top 10 Heisman contenders by stat formula',
            '`/weeklypreview` — Top upcoming matchups ranked by hype',
          ].join('\n'),
        },
        {
          name: '🧢 Coach Tools',
          value: [
            '`/coachstats <name>` — Coach resume with career record, titles, history',
            '`/coachleaderboard [sort]` — Top coaches by formula, wins, win%, conf titles, or rings',
            '`/openpositions [view] [conference]` — Ranks open coaching jobs by attractiveness',
          ].join('\n'),
        },
        {
          name: '🧢 Recruiting',
          value: [
            '`/recruitingclass <team>` — Upcoming recruiting class with 247 ranks',
            '`/toprecruits [position]` — Top recruits by position + commitments',
            '`/recruitoffers <player>` — 247-style offer board for one recruit',
          ].join('\n'),
        },
        {
          name: '📅 Schedule & Rankings',
          value: [
            '`/ooc <team> [year]` — Out-of-conference schedule',
            '`/rankingstats <team>` — All-time ranking history summary',
            '`/valueboard [conference]` — Team value rankings',
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
