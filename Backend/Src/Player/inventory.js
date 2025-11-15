// Src/Player/inventory.js

function addItem(player, item) {
  player.inventory.push(item);
}

function removeItem(player, itemName) {
  player.inventory = player.inventory.filter(i => i.name !== itemName);
}

module.exports = {
  addItem,
  removeItem,
};
