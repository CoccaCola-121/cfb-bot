// commands/h2h.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { loadAllGames } = require('../utils/h2hData');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('h2h')
    .setDescription('Head-to-head'),

  async execute(interaction) {
    const games = await loadAllGames();

    const a = 'Michigan';
    const b = 'Ohio State';

    const filtered = games.filter(
      (g) =>
        (g.teamA === a && g.teamB === b) ||
        (g.teamA === b && g.teamB === a)
    );

    let aWins = 0;
    let bWins = 0;

    for (const g of filtered) {
      if (g.winner === a) aWins++;
      else bWins++;
    }

    const embed = new EmbedBuilder()
      .setTitle(`H2H — ${a} vs ${b}`)
      .setDescription(`${aWins}-${bWins}`);

    return interaction.reply({ embeds: [embed] });
  },
};