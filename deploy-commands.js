const { REST, Routes } = require('discord.js');
require('dotenv').config();

const loadweek = require('./commands/loadweek');

const commands = [
  loadweek.data.toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering guild commands...');
    const data = await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log('Registered commands:');
    for (const cmd of data) {
      console.log({
        name: cmd.name,
        description: cmd.description,
        options: cmd.options?.map(o => ({
          name: o.name,
          type: o.type,
          required: o.required
        })) || []
      });
    }
  } catch (error) {
    console.error(error);
  }
})();