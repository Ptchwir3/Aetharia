// Backend/Src/Player/player.js
const { PLAYER } = require('../Utils/constants');

function createPlayer(id, options = {}) {
  return {
    id,
    username: options.username || null,
    x: options.x !== undefined ? options.x : PLAYER.SPAWN_X,
    y: options.y !== undefined ? options.y : PLAYER.SPAWN_Y,
    zone: options.zone || null,
    inventory: options.inventory || [],
    credits: options.credits !== undefined ? options.credits : 100,
    // Profile
    name: options.username || options.name || id.substring(0, 6),
    color: options.color || '#FF5722',
    // Physics
    velocityY: 0,
    onGround: false,
    // Timestamps
    connectedAt: Date.now(),
    lastMessageAt: Date.now(),
    messageCount: 0,
    // Flags
    isAI: options.isAI || false,
    authenticated: options.authenticated || false,
  };
}

module.exports = { createPlayer };
