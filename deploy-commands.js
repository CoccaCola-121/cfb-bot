const { REST, Routes } = require('discord.js');
require('dotenv').config();

const loadweek = require('./commands/loadweek');

const commands = [
  loadweek.data.toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application guild commands...');

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log('Successfully reloaded application guild commands.');
  } catch (error) {
    console.error(error);
  }
})();