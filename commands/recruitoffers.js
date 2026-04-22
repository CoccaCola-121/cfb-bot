// ============================================================
//  commands/recruitoffers.js
//  /recruitoffers <player>
//
//  247-style recruit offer board. Scans the most recent
//  "2060 X-Star Recruiting #N-M" posts on r/NZCFL and pulls
//  the list of teams that have either offered or rescinded an
//  offer on a given recruit.
//
//  Post structure (confirmed from a live post):
//    • Title: "2060 3-Star Recruiting #301-350"
//    • Top-level comments from OP describe each recruit:
//        "#301 Brady Duplessis, DL, 36/64"
//    • Replies to that comment list offers:
//        "Houston offers #301 Brady Duplessis DL"
//        "Navy rescinds offer on #301 Brady Duplessis"
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  findPlayerByName,
  getRedditPosts,
  getRedditComments,
  getTeamName,
  getTeamLogoUrl,
  getLatestPosition,
} = require('../utils/data');
const { matchesTeam, normalize } = require('../utils/sheets');

// Matches the OP's recruit summary comment:
//   "#301 Brady Duplessis, DL, 36/64"
// Also tolerates extra whitespace, slashes in position (e.g. "OT/OG"),
// and an optional leading bullet or bold marker.
const RECRUIT_HEADER_RE =
  /^\s*\**\s*#(\d{1,4})\s+([^,\n]+?),\s*([A-Z][A-Z/]*)\s*,\s*(\d{1,3})\s*\/\s*(\d{1,3})/i;

// Matches an offer/rescind reply. The verb may be "offers", "offer",
// "offered", "rescinds", "rescinded", "pulls", etc.
const OFFER_VERB_RE =
  /\b(offers?|offered|rescinds?|rescinded|pulls?|dropped?|withdraws?)\b/i;

// Title pattern for the recruiting threads we care about.
const RECRUIT_POST_RE = /\b20\d{2}\s+\d+[-\s]?star\s+recruiting\s+#\d+[-–]\d+/i;

// Given a post title or comment, return true if it looks like a recruit
// thread we want to scan.
function isRecruitingPost(post) {
  const title = String(post?.title || '');
  return RECRUIT_POST_RE.test(title);
}

// Case-insensitive, punctuation-tolerant name equality.
function namesEqual(a, b) {
  return normalize(a).replace(/[^a-z0-9]/g, '') ===
         normalize(b).replace(/[^a-z0-9]/g, '');
}

// Pull the team name from an offer/rescind reply. The Reddit replies
// almost always lead with the team name, then the verb:
//   "Houston offers #301 Brady Duplessis DL"
//   "Ohio State rescinds offer on #301 Brady Duplessis"
// We grab everything from the start of the body up to (but not
// including) the first offer verb.
function parseOfferReply(body) {
  const text = String(body || '').trim().replace(/^\**\s*/, '').replace(/\s*\**$/, '');
  if (!text) return null;

  const verbMatch = text.match(OFFER_VERB_RE);
  if (!verbMatch) return null;

  const verb = verbMatch[0].toLowerCase();
  const teamPart = text.slice(0, verbMatch.index).trim();
  if (!teamPart) return null;

  const rescind =
    verb.startsWith('rescind') ||
    verb.startsWith('pull') ||
    verb.startsWith('drop') ||
    verb.startsWith('withdraw');

  return { teamRaw: teamPart, rescind };
}

// Look through a comment tree and find the top-level comment whose
// body starts with the recruit header line matching the target player.
// Returns { headerComment, rank, rating, potential, displayName, pos }
function findRecruitComment(comments, player) {
  const first = String(player.firstName || '').trim();
  const last = String(player.lastName || '').trim();
  const fullName = `${first} ${last}`.trim();

  for (const c of comments || []) {
    const firstLine = String(c.body || '').split(/\r?\n/)[0];
    const m = firstLine.match(RECRUIT_HEADER_RE);
    if (!m) continue;

    const [, rank, nameRaw, posRaw, rating, potential] = m;
    const name = nameRaw.trim();
    if (!namesEqual(name, fullName)) continue;

    return {
      headerComment: c,
      rank: Number(rank),
      rating: Number(rating),
      potential: Number(potential),
      displayName: name,
      pos: posRaw.toUpperCase(),
    };
  }

  return null;
}

// Resolve a raw team string from a Reddit reply to an actual Football-GM
// team object. Tries alias matching first, then a looser "normalized
// team-string contains / is contained by alias" pass.
function resolveTeam(raw, teams) {
  if (!raw) return null;

  // Exact alias match (regions, names, abbreviations, common aliases).
  for (const t of teams) {
    if (matchesTeam(raw, t)) return t;
  }

  // Looser: strip common suffixes like "University of", "the", "State".
  const norm = normalize(raw);
  if (!norm) return null;

  for (const t of teams) {
    const variants = [t.abbrev, t.region, t.name, getTeamName(t)]
      .map((v) => normalize(v || ''))
      .filter((v) => v && v.length >= 3);

    for (const v of variants) {
      if (v === norm) return t;
      if (norm === v + normalize('university')) return t;
      if (norm.startsWith(v) && norm.length - v.length <= 6) return t;
      if (v.startsWith(norm) && v.length - norm.length <= 6) return t;
    }
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recruitoffers')
    .setDescription("247-style offer board for a single recruit")
    .addStringOption((opt) =>
      opt
        .setName('player')
        .setDescription('Recruit name (first + last)')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData?.players) {
      return interaction.editReply('❌ No league data loaded. Ask a mod to run `/loadweek`.');
    }

    const query = interaction.options.getString('player').trim();
    const player = findPlayerByName(leagueData, query);
    if (!player) {
      return interaction.editReply(`❌ Could not find a player matching **${query}**.`);
    }

    const fullName = `${player.firstName || ''} ${player.lastName || ''}`.trim();
    const activeTeams = (leagueData.teams || []).filter((t) => !t.disabled);

    // Fetch recent posts and keep only the recruiting threads. User said
    // the last ~17 posts match the pattern, so 25 is a safe limit.
    let posts;
    try {
      posts = await getRedditPosts(25, 'new');
    } catch (err) {
      return interaction.editReply(`❌ Could not reach Reddit: ${err.message}`);
    }

    const recruitPosts = (posts || []).filter(isRecruitingPost);
    if (!recruitPosts.length) {
      return interaction.editReply(
        '❌ No recruiting posts found in the most recent subreddit activity.'
      );
    }

    // Walk the posts from newest to oldest, stopping at the first one
    // that contains a header comment for this recruit.
    let match = null;
    let matchedPost = null;
    for (const post of recruitPosts) {
      let comments;
      try {
        comments = await getRedditComments(post.id, { limit: 500, depth: 4 });
      } catch {
        continue;
      }
      const hit = findRecruitComment(comments, player);
      if (hit) {
        match = hit;
        matchedPost = post;
        break;
      }
    }

    if (!match) {
      return interaction.editReply(
        `❌ Couldn't find **${fullName}** in the latest ${recruitPosts.length} ` +
          `recruiting post${recruitPosts.length === 1 ? '' : 's'}.`
      );
    }

    // Walk replies (plus nested replies, to be safe) and track the
    // latest status per unique team. We key by normalized team name so
    // multiple spellings of the same school collapse.
    const status = new Map(); // key -> { team, raw, rescind, ts }
    const stack = [...(match.headerComment.replies || [])];
    while (stack.length) {
      const reply = stack.shift();
      if (!reply) continue;
      if (reply.replies?.length) stack.push(...reply.replies);

      const parsed = parseOfferReply(reply.body);
      if (!parsed) continue;

      const teamObj = resolveTeam(parsed.teamRaw, activeTeams);
      const key = teamObj ? teamObj.tid : `raw:${normalize(parsed.teamRaw)}`;
      const existing = status.get(key);
      const ts = Number(reply.created_utc) || 0;

      if (!existing || ts >= existing.ts) {
        status.set(key, {
          team: teamObj,
          raw: parsed.teamRaw,
          rescind: parsed.rescind,
          ts,
        });
      }
    }

    const active = [];
    const rescinded = [];
    for (const entry of status.values()) {
      const label = entry.team
        ? `**${getTeamName(entry.team)}**`
        : `*${entry.raw}*`;
      (entry.rescind ? rescinded : active).push(label);
    }

    // Sort alphabetically for readability.
    const alphaSort = (a, b) =>
      a.replace(/\*/g, '').localeCompare(b.replace(/\*/g, ''));
    active.sort(alphaSort);
    rescinded.sort(alphaSort);

    const pos = match.pos || getLatestPosition(player) || '—';
    const rankLine = `#${match.rank}  •  ${pos}  •  ${match.rating}/${match.potential}`;

    const fields = [
      {
        name: `🎯 Active Offers (${active.length})`,
        value: active.length ? active.join('\n') : '_None_',
        inline: false,
      },
    ];
    if (rescinded.length) {
      fields.push({
        name: `⛔ Rescinded (${rescinded.length})`,
        value: rescinded.map((t) => `~~${t}~~`).join('\n'),
        inline: false,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📋 ${fullName} — Recruit Offer Board`)
      .setColor(0xc0392b)
      .setDescription(rankLine)
      .addFields(fields)
      .setURL(`https://reddit.com${matchedPost.permalink}`)
      .setFooter({
        text: `Source: r/${process.env.REDDIT_SUBREDDIT || 'NZCFL'} • ${matchedPost.title}`,
      })
      .setTimestamp();

    // Show logo of the single active suitor, if any, as a visual cue.
    if (active.length === 1) {
      const onlyEntry = [...status.values()].find(
        (e) => !e.rescind && e.team && `**${getTeamName(e.team)}**` === active[0]
      );
      const logo = onlyEntry?.team ? getTeamLogoUrl(onlyEntry.team) : null;
      if (logo) embed.setThumbnail(logo);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
