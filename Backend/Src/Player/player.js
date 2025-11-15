// Src/Player/player.js

function createPlayer(id) {
  return {
    id,
    x: 0,
    y: 0,
    zone: null,
    inventory: [],
  };
}

module.exports = {
  createPlayer,
};
