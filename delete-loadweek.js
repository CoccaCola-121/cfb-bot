const { REST, Routes } = require('discord.js');
require('dotenv').config();

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const commands = await rest.get(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      )
    );

    const target = commands.find(cmd => cmd.name === 'loadweek');

    if (!target) {
      console.log('No guild command named loadweek found.');
      return;
    }

    await rest.delete(
      Routes.applicationGuildCommand(
        process.env.CLIENT_ID,
        process.env.GUILD_ID,
        target.id
      )
    );

    console.log(`Deleted guild command /${target.name} (${target.id})`);
  } catch (err) {
    console.error(err);
  }
})();