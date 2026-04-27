// ============================================================
//  utils/permissions.js
// ============================================================

const ADMIN_ROLE_IDS_BY_GUILD = {
  [process.env.NZCFL_GUILD_ID]: [
    process.env.NZCFL_COMMISSIONER_ROLE_ID,
    process.env.NZCFL_MOD_ROLE_ID,
    process.env.NZCFL_LEGACY_MOD_ROLE_ID,
    process.env.NZCFL_LEAGUE_OWNER_ROLE_ID,
  ],
  [process.env.TEST_GUILD_ID]: [
    process.env.TEST_MOD_ROLE_ID,
  ],
};

function getAllowedRoleIds(guildId) {
  return (ADMIN_ROLE_IDS_BY_GUILD[guildId] || []).filter(Boolean);
}

function isBotAdmin(interaction) {
  const allowedRoleIds = getAllowedRoleIds(interaction.guildId);
  if (!allowedRoleIds.length) return false;

  const memberRoles = interaction.member?.roles?.cache;
  if (!memberRoles) return false;

  return allowedRoleIds.some((roleId) => memberRoles.has(roleId));
}

async function requireBotAdmin(interaction, action = 'use this command') {
  if (isBotAdmin(interaction)) return true;

  const payload = {
    content: `❌ You do not have permission to ${action}.`,
    ephemeral: true,
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply(payload);
  }

  return false;
}

module.exports = {
  isBotAdmin,
  requireBotAdmin,
};