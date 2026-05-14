// ============================================================
//  commands/injuries.js
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getLatestLeagueData,
  getLatestPosition,
  getTeamName,
  getTeamLogoUrl,
  getCurrentSeason,
} = require('../utils/data');
const { getUserTeam } = require('../utils/userMap');

// Only roles we actually want to DISPLAY in this command.
// KR/PR removed on purpose.
const STARTER_SLOT_NUMBERS = {
  QB: new Set([1]),
  RB: new Set([1]),
  TE: new Set([1]),
  WR: new Set([1, 2, 3]),
  OL: new Set([1, 2, 3, 4, 5]),
  DL: new Set([1, 2, 3, 4, 5]),
  LB: new Set([1, 2, 3, 4]),
  CB: new Set([1, 2, 3, 4]),
  S: new Set([1, 2, 3]),
  K: new Set([1]),
  P: new Set([1]),
};

const DEPTH_KEY_ALIASES = {
  QB: 'QB',
  RB: 'RB',
  FB: 'RB',
  HB: 'RB',
  WR: 'WR',
  TE: 'TE',
  OL: 'OL',
  OT: 'OL',
  OG: 'OL',
  C: 'OL',
  DL: 'DL',
  DE: 'DL',
  DT: 'DL',
  LB: 'LB',
  ILB: 'LB',
  OLB: 'LB',
  CB: 'CB',
  S: 'S',
  FS: 'S',
  SS: 'S',
  K: 'K',
  PK: 'K',
  P: 'P',
  // Intentionally excluded from displayed roles
  KR: null,
  PR: null,
  RET: null,
};

function findTeamByAbbrev(leagueData, abbrev) {
  const target = String(abbrev || '').toUpperCase().trim();
  return (leagueData.teams || []).find(
    (t) => !t.disabled && String(t.abbrev || '').toUpperCase() === target
  );
}

function formatInjuryLength(gamesRemaining) {
  const games = Number(gamesRemaining ?? 0);
  if (games <= 0) return 'Day-to-day';
  if (games === 1) return '1 game';
  return `${games} games`;
}

function getLatestRatings(player) {
  const ratings = Array.isArray(player?.ratings) ? player.ratings : [];
  if (ratings.length === 0) return null;
  return ratings[ratings.length - 1] || null;
}

function getPlayerName(player) {
  return `${player.firstName || ''} ${player.lastName || ''}`.trim();
}

function normalizeDepthGroupKey(key) {
  const raw = String(key || '').trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(DEPTH_KEY_ALIASES, raw)) {
    return DEPTH_KEY_ALIASES[raw];
  }
  return raw;
}

function isStarterSlot(group, index) {
  const starters = STARTER_SLOT_NUMBERS[group];
  return !!starters && starters.has(index);
}

function isRedshirt(player) {
  const injury = player?.injury || {};
  const type = String(injury.type || '').trim().toLowerCase();
  return type === 'redshirt';
}

function getDepthSources(team) {
  const possible = [
    team?.depth,
    team?.depthChart,
    team?.depthCharts,
    team?.rosterOrder,
    team?.lineup,
  ];

  return possible.filter((x) => x && typeof x === 'object');
}

function extractPidFromDepthEntry(entry) {
  if (typeof entry === 'number') return entry;
  if (!entry || typeof entry !== 'object') return null;

  if (typeof entry.pid === 'number') return entry.pid;
  if (typeof entry.playerPid === 'number') return entry.playerPid;
  if (typeof entry.id === 'number') return entry.id;
  if (entry.player && typeof entry.player.pid === 'number') return entry.player.pid;

  return null;
}

function getPlayerOvr(player) {
  const ratings = getLatestRatings(player);
  return Number(ratings?.ovr ?? 0);
}

function getPlayerPot(player) {
  const ratings = getLatestRatings(player);
  return Number(ratings?.pot ?? 0);
}

function buildExplicitStarterSlots(team, rosterPlayers) {
  const playerPidSet = new Set(rosterPlayers.map((p) => p.pid));
  const depthSources = getDepthSources(team);
  const slotsByPid = new Map();
  const seenSlots = new Set();

  for (const source of depthSources) {
    for (const [rawKey, rawValue] of Object.entries(source)) {
      if (!Array.isArray(rawValue)) continue;

      const group = normalizeDepthGroupKey(rawKey);
      if (!group) continue;
      if (!STARTER_SLOT_NUMBERS[group]) continue;

      for (let i = 0; i < rawValue.length; i++) {
        const index = i + 1;
        if (!isStarterSlot(group, index)) continue;

        const pid = extractPidFromDepthEntry(rawValue[i]);
        if (pid == null || !playerPidSet.has(pid)) continue;

        const slotKey = `${pid}:${group}:${index}`;
        if (seenSlots.has(slotKey)) continue;
        seenSlots.add(slotKey);

        if (!slotsByPid.has(pid)) {
          slotsByPid.set(pid, []);
        }

        slotsByPid.get(pid).push({
          group,
          index,
          label: `${group}${index}`,
        });
      }
    }
  }

  return {
    slotsByPid,
    hasExplicitDepth: slotsByPid.size > 0,
  };
}

function buildDerivedStarterSlots(rosterPlayers) {
  const grouped = new Map();

  for (const player of rosterPlayers) {
    const pos = normalizeDepthGroupKey(getLatestPosition(player));
    if (!pos) continue;
    if (!STARTER_SLOT_NUMBERS[pos]) continue;

    if (!grouped.has(pos)) {
      grouped.set(pos, []);
    }
    grouped.get(pos).push(player);
  }

  for (const [group, players] of grouped.entries()) {
    players.sort((a, b) => {
      const ovrDiff = getPlayerOvr(b) - getPlayerOvr(a);
      if (ovrDiff !== 0) return ovrDiff;

      const potDiff = getPlayerPot(b) - getPlayerPot(a);
      if (potDiff !== 0) return potDiff;

      return getPlayerName(a).localeCompare(getPlayerName(b));
    });
    grouped.set(group, players);
  }

  const slotsByPid = new Map();

  for (const [group, players] of grouped.entries()) {
    for (let i = 0; i < players.length; i++) {
      const index = i + 1;
      if (!isStarterSlot(group, index)) continue;

      const player = players[i];
      if (!slotsByPid.has(player.pid)) {
        slotsByPid.set(player.pid, []);
      }

      slotsByPid.get(player.pid).push({
        group,
        index,
        label: `${group}${index}`,
      });
    }
  }

  return { slotsByPid };
}

function dedupeAndSortSlots(slots) {
  const seen = new Set();
  const out = [];

  for (const slot of slots) {
    const key = `${slot.group}:${slot.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slot);
  }

  const groupOrder = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];

  return out.sort((a, b) => {
    const aIdx = groupOrder.indexOf(a.group);
    const bIdx = groupOrder.indexOf(b.group);

    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.index - b.index;
  });
}

function buildDisplayedStarterSlots(team, rosterPlayers) {
  const explicit = buildExplicitStarterSlots(team, rosterPlayers);
  const derived = buildDerivedStarterSlots(rosterPlayers);

  const displayedSlotsByPid = new Map();

  for (const player of rosterPlayers) {
    const explicitSlots = explicit.slotsByPid.get(player.pid) || [];
    const derivedSlots = derived.slotsByPid.get(player.pid) || [];

    const slots = explicitSlots.length > 0 ? explicitSlots : derivedSlots;

    if (slots.length > 0) {
      displayedSlotsByPid.set(player.pid, dedupeAndSortSlots(slots));
    }
  }

  return {
    displayedSlotsByPid,
    explicitDepthFound: explicit.hasExplicitDepth,
  };
}

function formatSlotText(slots) {
  if (!slots || slots.length === 0) return null;
  return slots.map((s) => s.label).join(' / ');
}

function getPlayerAge(player, currentSeason) {
  const directAge = Number(player?.age);
  if (Number.isFinite(directAge) && directAge > 0) {
    return directAge;
  }

  const bornYear = Number(player?.born?.year);
  if (Number.isFinite(bornYear) && Number.isFinite(currentSeason)) {
    return currentSeason - bornYear;
  }

  return null;
}

function getRedshirtGrade(player, currentSeason) {
  const age = getPlayerAge(player, currentSeason);

  if (!Number.isFinite(age)) return 'RS';
  if (age <= 19) return 'Fr (RS)';
  if (age === 20) return 'So (RS)';
  if (age === 21) return 'Jr (RS)';
  return 'Sr (RS)';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('injuries')
    .setDescription('Show current injuries and redshirts for a team')
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Team abbreviation, e.g. MSU (defaults to your linked team if you ran /iam)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const leagueData = getLatestLeagueData();
    if (!leagueData || !leagueData.teams || !leagueData.players) {
      return interaction.editReply('❌ No league data loaded.');
    }

    const teamArg = interaction.options.getString('team');
    let team = null;
    let abbrev = null;

    if (teamArg) {
      abbrev = teamArg.toUpperCase().trim();
      team = findTeamByAbbrev(leagueData, abbrev);
      if (!team) {
        return interaction.editReply(`❌ No active team found with abbreviation **${abbrev}**.`);
      }
    } else {
      team = await getUserTeam(leagueData, interaction.user.id);
      if (!team) {
        return interaction.editReply(
          '❌ No team specified and no linked coach found. ' +
            'Pass a team (e.g. `team: MSU`) or run `/iam coach:<your name>` first.'
        );
      }
      abbrev = team.abbrev;
    }

    const currentSeason = Number(getCurrentSeason(leagueData));
    const rosterPlayers = (leagueData.players || []).filter((player) => player.tid === team.tid);

    const { displayedSlotsByPid, explicitDepthFound } = buildDisplayedStarterSlots(team, rosterPlayers);

    const injuredPlayers = rosterPlayers
      .map((player) => {
        const injury = player.injury || {};
        const type = String(injury.type || '').trim();
        const gamesRemaining = Number(injury.gamesRemaining ?? 0);

        if (!type) return null;
        if (type.toLowerCase() === 'redshirt') return null;
        if (gamesRemaining <= 0) return null;

        const ratings = getLatestRatings(player);
        const slots = displayedSlotsByPid.get(player.pid) || [];
        const slotText = formatSlotText(slots);

        return {
          name: getPlayerName(player),
          pos: getLatestPosition(player),
          ovr: Number(ratings?.ovr ?? 0),
          pot: Number(ratings?.pot ?? 0),
          injury: type,
          gamesRemaining,
          slotText,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.gamesRemaining !== a.gamesRemaining) return b.gamesRemaining - a.gamesRemaining;
        return a.name.localeCompare(b.name);
      });

    const redshirts = rosterPlayers
      .filter((player) => isRedshirt(player))
      .map((player) => {
        const ratings = getLatestRatings(player);
        const slots = displayedSlotsByPid.get(player.pid) || [];
        const slotText = formatSlotText(slots);

        return {
          name: getPlayerName(player),
          pos: getLatestPosition(player),
          ovr: Number(ratings?.ovr ?? 0),
          pot: Number(ratings?.pot ?? 0),
          slotText,
          grade: getRedshirtGrade(player, currentSeason),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!injuredPlayers.length && !redshirts.length) {
      return interaction.editReply(`No current injuries or redshirts for **${getTeamName(team)} (${team.abbrev})**.`);
    }

    const lines = [];

    if (injuredPlayers.length) {
      for (const p of injuredPlayers) {
        const roleText = p.slotText || p.pos;
        lines.push(
          `**${p.name}** (${p.ovr}/${p.pot} ${roleText}) — **${p.injury}** • ${formatInjuryLength(p.gamesRemaining)}`
        );
      }
    } else {
      lines.push('*No current non-redshirt injuries.*');
    }

    if (redshirts.length) {
      lines.push('');
      lines.push('__Redshirts__');

      for (const p of redshirts) {
        const roleText = p.slotText || p.pos;
        lines.push(`${p.name} — ${p.grade} (${p.ovr}/${p.pot} ${roleText})`);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`🩹 ${getTeamName(team)} (${team.abbrev}) Injuries`)
      .setColor(0xe67e22)
      .setDescription(lines.join('\n'))
      .setFooter({
        text: explicitDepthFound
          ? 'Football GM export • Starter slots from depth chart where available'
          : 'Football GM export • Starter slots derived when chart unavailable',
      })
      .setTimestamp();

    const teamLogo = getTeamLogoUrl(team);
    if (teamLogo) {
      embed.setThumbnail(teamLogo);
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
