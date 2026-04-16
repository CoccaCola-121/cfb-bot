const { REST, Routes } = require('discord.js');
require('dotenv').config();

const loadweek = require('./commands/loadweek');

const commands = [loadweek.data.toJSON()];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const data = await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log('Guild commands deployed:');
    for (const cmd of data) {
      console.log(cmd.name, cmd.options?.map(o => o.name));
    }
  } catch (err) {
    console.error(err);
  }
})();