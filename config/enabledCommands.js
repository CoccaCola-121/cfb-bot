const disabledCommands = require('./disabledCommands');

const disabledSet = new Set(disabledCommands);

function isCommandEnabled(commandName) {
  return Boolean(commandName) && !disabledSet.has(commandName);
}

module.exports = {
  disabledCommands,
  isCommandEnabled,
};
