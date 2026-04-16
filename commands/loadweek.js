const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs/promises');
const path = require('path');

const SAVE_PATH = path.join(process.cwd(), 'data', 'weekData.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loadweek')
    .setDescription('Load week data from a JSON attachment')
    .addAttachmentOption(option =>
      option
        .setName('weekfile')
        .setDescription('Upload a .json file')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      console.log('Received /loadweek');
      console.log(
        JSON.stringify(
          interaction.options.data.map(o => ({
            name: o.name,
            type: o.type,
            value: o.value ?? null,
            attachmentName: o.attachment?.name ?? null,
            attachmentUrl: o.attachment?.url ?? null
          })),
          null,
          2
        )
      );

      const attachment = interaction.options.getAttachment('weekfile', true);

      const res = await fetch(attachment.url, {
        headers: { 'User-Agent': 'NZCFLBot/1.0' }
      });

      if (!res.ok) {
        throw new Error(`attachment download failed: HTTP ${res.status}`);
      }

      const text = (await res.text()).replace(/^\uFEFF/, '').trim();

      if (!text) {
        throw new Error('uploaded file was empty');
      }

      if (text[0] !== '{' && text[0] !== '[') {
        throw new Error(`file starts with "${text.slice(0, 20)}", not JSON`);
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`invalid JSON: ${err.message}`);
      }

      await fs.mkdir(path.dirname(SAVE_PATH), { recursive: true });
      await fs.writeFile(SAVE_PATH, JSON.stringify(parsed, null, 2), 'utf8');

      await interaction.editReply(
        `✅ Loaded week data from **${attachment.name}**`
      );
    } catch (err) {
      console.error('[loadweek] error:', err);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`❌ Failed to load week data: ${err.message}`);
      } else {
        await interaction.reply(`❌ Failed to load week data: ${err.message}`);
      }
    }
  }
};