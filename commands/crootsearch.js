const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  CROOT_VALUE_COLUMNS,
  loadCrootRankings,
  loadCrootValues,
  findCrootValuesByName,
} = require('../utils/crootRankings');
const { normalize } = require('../utils/sheets');

const VALUE_CHOICES = CROOT_VALUE_COLUMNS.map((entry) => ({
  name: entry.label,
  value: entry.label,
}));

function formatRank(rank) {
  return rank ? `#${rank}` : 'Unranked';
}

function getSelectedValues(interaction) {
  return ['value1', 'value2', 'value3']
    .map((name) => interaction.options.getString(name))
    .filter(Boolean);
}

function hasDuplicateValues(values) {
  const seen = new Set();
  for (const value of values) {
    const key = normalize(value);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function topValueLabels(valueProfile, limit = 3) {
  return (valueProfile?.values || [])
    .slice(0, limit)
    .map((entry) => entry.label);
}

function hasAllSelectedValues(topValues, selectedValues) {
  const topSet = new Set(topValues.map(normalize));
  return selectedValues.every((value) => topSet.has(normalize(value)));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crootsearch')
    .setDescription('Find available croots by top values')
    .addStringOption((opt) =>
      opt
        .setName('value1')
        .setDescription('Required croot value')
        .setRequired(true)
        .addChoices(...VALUE_CHOICES)
    )
    .addStringOption((opt) =>
      opt
        .setName('value2')
        .setDescription('Optional second croot value')
        .setRequired(false)
        .addChoices(...VALUE_CHOICES)
    )
    .addStringOption((opt) =>
      opt
        .setName('value3')
        .setDescription('Optional third croot value')
        .setRequired(false)
        .addChoices(...VALUE_CHOICES)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const selectedValues = getSelectedValues(interaction);
    if (hasDuplicateValues(selectedValues)) {
      return interaction.editReply('❌ Pick each value only once.');
    }

    let recruits;
    let crootValues;
    try {
      [{ recruits }, crootValues] = await Promise.all([
        loadCrootRankings(),
        loadCrootValues(),
      ]);
    } catch (err) {
      return interaction.editReply(`❌ Failed to load croot data: ${err.message}`);
    }

    if (!recruits.length || !crootValues.length) {
      return interaction.editReply('❌ No croot rankings/value data found.');
    }

    const matches = recruits
      .filter((recruit) => !recruit.committed)
      .map((recruit) => {
        const valueProfile = findCrootValuesByName(crootValues, recruit.name);
        const topValues = topValueLabels(valueProfile);
        if (!hasAllSelectedValues(topValues, selectedValues)) return null;
        return { recruit, topValues };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const rankA = a.recruit.rank || Infinity;
        const rankB = b.recruit.rank || Infinity;
        if (rankA !== rankB) return rankA - rankB;
        return a.recruit.name.localeCompare(b.recruit.name);
      })
      .slice(0, 25);

    const valueLine = selectedValues.join(' • ');
    if (!matches.length) {
      return interaction.editReply(`No available croots found with top values: **${valueLine}**.`);
    }

    const lines = matches.map(({ recruit, topValues }, index) => {
      return `\`${String(index + 1).padStart(2)}\` **${recruit.name}** (${recruit.pos || '?'}) — ${formatRank(recruit.rank)} • ${topValues.join(' • ')}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x2b4b8c)
      .setTitle('🔎 Croot Search')
      .setDescription(lines.join('\n'))
      .addFields({
        name: 'Values',
        value: valueLine,
      })
      .setFooter({ text: 'Available croots only • Sorted by class rank' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
