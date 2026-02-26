// Backend/Src/Player/inventory.js
//
// AETHARIA — Inventory Management
// ================================
// Handles adding, removing, and querying items in a player's
// inventory. Enforces max inventory size and validates inputs.
//
// Item structure:
//   { name: string, type: string, quantity: number }
//
// Items with the same name stack by increasing quantity.
// Removing reduces quantity; item is deleted when quantity hits 0.

const { PLAYER } = require('../Utils/constants');

/**
 * Add an item to a player's inventory.
 * If the item already exists (by name), increases its quantity.
 * Respects MAX_INVENTORY limit.
 *
 * @param {object} player - Player object with inventory array
 * @param {object} item - Item to add: { name, type, quantity }
 * @returns {boolean} true if added, false if inventory is full
 */
function addItem(player, item) {
  if (!player || !item || !item.name) return false;

  // Check if item already exists in inventory (stack it)
  const existing = player.inventory.find((i) => i.name === item.name);
  if (existing) {
    existing.quantity = (existing.quantity || 1) + (item.quantity || 1);
    return true;
  }

  // Check inventory capacity
  if (player.inventory.length >= PLAYER.MAX_INVENTORY) {
    return false;
  }

  // Add new item with defaults
  player.inventory.push({
    name: item.name,
    type: item.type || 'misc',
    quantity: item.quantity || 1,
  });

  return true;
}

/**
 * Remove an item (or reduce its quantity) from a player's inventory.
 *
 * @param {object} player - Player object with inventory array
 * @param {string} itemName - Name of the item to remove
 * @param {number} [quantity=1] - How many to remove
 * @returns {boolean} true if removed, false if item not found or insufficient quantity
 */
function removeItem(player, itemName, quantity = 1) {
  if (!player || !itemName) return false;

  const index = player.inventory.findIndex((i) => i.name === itemName);
  if (index === -1) return false;

  const item = player.inventory[index];
  item.quantity = (item.quantity || 1) - quantity;

  // Remove entirely if quantity drops to 0 or below
  if (item.quantity <= 0) {
    player.inventory.splice(index, 1);
  }

  return true;
}

/**
 * Check if a player has a specific item (and optionally a minimum quantity).
 *
 * @param {object} player - Player object with inventory array
 * @param {string} itemName - Name of the item to check
 * @param {number} [minQuantity=1] - Minimum quantity required
 * @returns {boolean} true if player has the item in sufficient quantity
 */
function hasItem(player, itemName, minQuantity = 1) {
  if (!player || !itemName) return false;

  const item = player.inventory.find((i) => i.name === itemName);
  if (!item) return false;

  return (item.quantity || 1) >= minQuantity;
}

/**
 * Get the full inventory as a plain array (safe for JSON serialization).
 *
 * @param {object} player - Player object with inventory array
 * @returns {Array} Copy of the inventory array
 */
function getInventory(player) {
  if (!player) return [];
  return [...player.inventory];
}

module.exports = {
  addItem,
  removeItem,
  hasItem,
  getInventory,
};
