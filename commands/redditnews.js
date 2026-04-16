// ============================================================
//  commands/redditnews.js
//  /redditnews [sort]
//  Shows latest posts from the league subreddit
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getRedditPosts } = require('../utils/data');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('redditnews')
    .setDescription('Latest posts from the league subreddit')
    .addStringOption(opt =>
      opt.setName('sort')
         .setDescription('How to sort posts (default: new)')
         .setRequired(false)
         .addChoices(
           { name: 'New',    value: 'new'  },
           { name: 'Hot',    value: 'hot'  },
           { name: 'Top',    value: 'top'  },
         )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const sort = interaction.options.getString('sort') || 'new';

    let posts;
    try {
      posts = await getRedditPosts(8, sort);
    } catch (err) {
      return interaction.editReply(`❌ Could not reach Reddit: ${err.message}`);
    }

    if (!posts || posts.length === 0) {
      return interaction.editReply('No posts found in the subreddit.');
    }

    const fields = posts.slice(0, 8).map(p => ({
      name:   p.title.slice(0, 256),
      value:  [
        `👤 u/${p.author}`,
        `⬆️ ${p.score}`,
        `💬 ${p.num_comments} comments`,
        `🔗 [View post](https://reddit.com${p.permalink})`,
      ].join('  •  '),
      inline: false,
    }));

    const sub = process.env.REDDIT_SUBREDDIT;
    const embed = new EmbedBuilder()
      .setTitle(`📰 r/${sub} — ${sort.charAt(0).toUpperCase() + sort.slice(1)} posts`)
      .setColor(0xff4500)  // Reddit orange
      .addFields(fields)
      .setURL(`https://www.reddit.com/r/${sub}/${sort}`)
      .setFooter({ text: 'Via Reddit public API  •  /redditnews [new|hot|top]' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
