// ============================================================
//  commands/help.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const HELP_CATEGORIES = {
  personalize: {
    label: '🪪 Personalize',
    description: 'Start here if you want the bot to know who you are and what team you coach.',
    lines: [
      '`/iam coach:<your name>` — Link yourself to your coach so most commands can auto-fill your team.',
      '`/iam` — Show who you are currently linked to.',
      '`/iam clear:true` — Remove your saved coach link.',
      '`/recordupdate year:<yr> wins:<n> losses:<n>` — Fix your record for one year if you changed jobs midseason.',
      '`/recordupdate` — Show your saved record fixes.',
      '`/recordupdate year:<yr> clear:true` — Remove one fix, or use just `clear:true` to remove them all.',
    ],
    tip: 'Once you link with `/iam`, most team and coach commands work without needing a team every time.',
  },
  stats: {
    label: '📊 Stats & Standings',
    description: 'Use these to look up teams, players, standings, rankings, and schedules.',
    lines: [
      '`/standings <conference>` — See the conference standings.',
      '`/rankings` — See the current Top 25 rankings.',
      '`/teamstats <team>` — See one team’s full stat page.',
      '`/teamleaderboards <stat>` — See the top teams in one stat.',
      '`/teamschedule [team] [year]` — See a current, past, or future schedule.',
      '`/boxscore <team> [week]` — Open one game’s full box score.',
      '`/compareteams <team1> <team2>` — Compare two teams side by side.',
      '`/playerleaders <stat>` — See the top players in one stat.',
      '`/playerpage <player>` — Open one player’s profile.',
      '`/injuries <team>` — See injuries and redshirts.',
      '`/confoverview <conference>` — Quick conference-wide snapshot.',
    ],
  },
  coaches: {
    label: '🧢 Coach Tools',
    description: 'Use this to look up a coach resume and team history.',
    lines: [
      '`/coachstats <name>` — See one coach’s resume and team history.',
    ],
  },
  history: {
    label: '📜 History & Rivalries',
    description: 'Use these for head-to-head records, streaks, program history, and rivalry tracking.',
    lines: [
      '`/h2h opponent:<team|coach> [as]` — Head-to-head record against a team or coach.',
      '`/streaks [vs] [as] [active:no]` — Rivalry streaks. Defaults to active streaks.',
      '`/familytree [as]` — Shows who you own and who owns you.',
      '`/teamhistory <team>` — See a program’s coaching eras and titles.',
    ],
    tip: 'If you type a coach name into `/h2h opponent:...`, it now auto-switches to coach mode unless you override it.',
  },
  recruiting: {
    label: '🧢 Recruiting',
    description: 'Use these to track classes and prospects.',
    lines: [
      '`/recruitingclass <team>` — See a team’s incoming class.',
      '`/toprecruits [position]` — See the top recruits.',
    ],
  },
  rankings: {
    label: '📅 Rankings',
    description: 'Use these for ranking history and team value views.',
    lines: [
      '`/rankingstats <team>` — See a team’s ranking history.',
      '`/valueboard [conference]` — Team value rankings.',
    ],
  },
  mods: {
    label: '⚙️ Mod Tools',
    description: 'These are mostly for commissioners or bot admins.',
    lines: [
      '`/loadweek [file or url] [label]` — Load a new Football GM export.',
      '`/datafiles` — See saved files and cache info.',
      '`/seasonmode` — Inspect or change the current season-data source.',
    ],
  },
};

const CATEGORY_CHOICES = [
  { name: 'Overview', value: 'overview' },
  { name: 'Personalize', value: 'personalize' },
  { name: 'Stats', value: 'stats' },
  { name: 'Coaches', value: 'coaches' },
  { name: 'History', value: 'history' },
  { name: 'Recruiting', value: 'recruiting' },
  { name: 'Rankings', value: 'rankings' },
  { name: 'Mod Tools', value: 'mods' },
];

function buildOverviewEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('🏈 NZCFL Bot Help')
    .setColor(0x2b4b8c)
    .setDescription(
      [
        'Use `/help category:<name>` to see one section at a time.',
        '',
        '**Best place to start:** `/help category:personalize`',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Categories',
        value: [
          '`personalize` — Link yourself so commands auto-fill your team',
          '`stats` — Teams, players, standings, rankings, schedules',
          '`coaches` — Coach resumes and team history',
          '`history` — H2H, streaks, program history, rivalry tools',
          '`recruiting` — Classes and recruits',
          '`rankings` — Ranking history and value boards',
          '`mods` — Commissioner/admin tools',
        ].join('\n'),
      },
      {
        name: 'Quick Start',
        value: [
          '`/iam coach:<your name>`',
          '`/teamstats`',
          '`/teamschedule`',
          '`/h2h opponent:<team or coach>`',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Tip: `/help category:history` is a good place for rivalry commands.' });

  return embed;
}

function buildCategoryEmbed(categoryKey) {
  const category = HELP_CATEGORIES[categoryKey];
  if (!category) return buildOverviewEmbed();

  const embed = new EmbedBuilder()
    .setTitle(`${category.label} Help`)
    .setColor(0x2b4b8c)
    .setDescription(category.description)
    .addFields({
      name: 'Commands',
      value: category.lines.join('\n'),
    });

  if (category.tip) {
    embed.addFields({
      name: 'Tip',
      value: category.tip,
    });
  }

  embed.setFooter({ text: 'Use `/help category:overview` to go back to the main help page.' });
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get help for the bot')
    .addStringOption((opt) =>
      opt
        .setName('category')
        .setDescription('Pick one help category')
        .setRequired(false)
        .addChoices(...CATEGORY_CHOICES)
    ),

  async execute(interaction) {
    const category = interaction.options.getString('category') || 'overview';
    const embed =
      category === 'overview'
        ? buildOverviewEmbed()
        : buildCategoryEmbed(category);

    return interaction.reply({ embeds: [embed], ephemeral: false });
  },
};
