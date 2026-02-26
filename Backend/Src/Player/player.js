// Backend/Src/Player/player.js
const { PLAYER } = require('../Utils/constants');

function createPlayer(id, options = {}) {
  return {
    id,
    x: options.x !== undefined ? options.x : PLAYER.SPAWN_X,
    y: options.y !== undefined ? options.y : PLAYER.SPAWN_Y,
    zone: null,
    inventory: [],
    // Profile
    name: options.name || id.substring(0, 6),
    color: options.color || '#FF5722',
    // Timestamps
    connectedAt: Date.now(),
    lastMessageAt: Date.now(),
    messageCount: 0,
    // Flags
    isAI: options.isAI || false,
  };
}

module.exports = { createPlayer };
