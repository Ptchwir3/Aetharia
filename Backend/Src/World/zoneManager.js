// Backend/Src/World/zoneManager.js
//
// AETHARIA — Zone Manager
// ================================
// Manages spatial zones in the world. Each zone represents a
// rectangular region of chunks that can be "owned" by a
// different server node in the cluster.
//
// Key responsibilities:
//   - Assign players to zones based on their position
//   - Track which players are in each zone
//   - Remove players from zones on disconnect
//   - Detect when a player crosses a zone boundary
//   - Provide zone-scoped player lists for broadcasting
//
// Zone boundaries are defined in chunk coordinates in constants.js.
// The zone manager doesn't know about networking or WebSockets —
// it's pure spatial logic. The main server uses it to decide
// where to route messages.

const { ZONES, WORLD } = require('../Utils/constants');
const log = require('../Utils/logger');

// ─────────────────────────────────────────────
// Zone Player Registry
// ─────────────────────────────────────────────
// Maps zone IDs to Sets of player IDs.
// Using Sets for O(1) add/remove/has operations.

const zonePlayers = {};

// Initialize all defined zones with empty player sets
for (const zoneId of Object.keys(ZONES.DEFINITIONS)) {
  zonePlayers[zoneId] = new Set();
}

// ─────────────────────────────────────────────
// Zone Lookup by Position
// ─────────────────────────────────────────────
// Given a tile position, determine which zone it belongs to.
// Converts tile coords to chunk coords, then checks against
// zone boundary definitions.

/**
 * Determine which zone a position belongs to.
 *
 * @param {number} tileX - X position in tile coordinates
 * @param {number} tileY - Y position in tile coordinates
 * @returns {string} Zone ID (e.g., 'zone_central')
 */
function getZoneForPosition(tileX, tileY) {
  // Convert tile position to chunk position
  const chunkX = Math.floor(tileX / WORLD.CHUNK_SIZE);
  const chunkY = Math.floor(tileY / WORLD.CHUNK_SIZE);

  // Check each zone's boundaries
  for (const [zoneId, bounds] of Object.entries(ZONES.DEFINITIONS)) {
    if (
      chunkX >= bounds.minX &&
      chunkX <= bounds.maxX &&
      chunkY >= bounds.minY &&
      chunkY <= bounds.maxY
    ) {
      return zoneId;
    }
  }

  // If position doesn't fall in any defined zone, use default
  return ZONES.DEFAULT;
}

// ─────────────────────────────────────────────
// Player Assignment
// ─────────────────────────────────────────────

/**
 * Assign a player to the appropriate zone based on their position.
 * Adds them to the zone's player set and returns the zone ID.
 *
 * @param {string} playerId - Player's unique ID
 * @param {number} tileX - Player's X position (tile coords)
 * @param {number} tileY - Player's Y position (tile coords)
 * @returns {string} The zone ID the player was assigned to
 */
function assignPlayerToZone(playerId, tileX, tileY) {
  const zoneId = getZoneForPosition(tileX, tileY);

  // Ensure the zone exists in our registry
  if (!zonePlayers[zoneId]) {
    zonePlayers[zoneId] = new Set();
  }

  zonePlayers[zoneId].add(playerId);
  log(`🧭 Player ${playerId} assigned to ${zoneId} (${zonePlayers[zoneId].size} players in zone)`);

  return zoneId;
}

// ─────────────────────────────────────────────
// Player Removal
// ─────────────────────────────────────────────

/**
 * Remove a player from a specific zone.
 * Called on disconnect or when a player moves to a different zone.
 *
 * @param {string} playerId - Player's unique ID
 * @param {string} zoneId - Zone to remove them from
 */
function removePlayerFromZone(playerId, zoneId) {
  if (zonePlayers[zoneId]) {
    zonePlayers[zoneId].delete(playerId);
    log(`🚪 Player ${playerId} removed from ${zoneId} (${zonePlayers[zoneId].size} remaining)`);
  }
}

// ─────────────────────────────────────────────
// Zone Transfer (Player Crosses Boundary)
// ─────────────────────────────────────────────

/**
 * Check if a player has moved to a different zone and handle
 * the transfer if so. Returns the new zone ID if changed,
 * or null if the player stayed in the same zone.
 *
 * @param {string} playerId - Player's unique ID
 * @param {string} currentZone - Player's current zone ID
 * @param {number} newX - Player's new X position (tile coords)
 * @param {number} newY - Player's new Y position (tile coords)
 * @returns {string|null} New zone ID if changed, null if same zone
 */
function checkZoneTransfer(playerId, currentZone, newX, newY) {
  const newZone = getZoneForPosition(newX, newY);

  if (newZone !== currentZone) {
    // Remove from old zone
    removePlayerFromZone(playerId, currentZone);

    // Add to new zone
    if (!zonePlayers[newZone]) {
      zonePlayers[newZone] = new Set();
    }
    zonePlayers[newZone].add(playerId);

    log(`🔀 Player ${playerId} transferred: ${currentZone} → ${newZone}`);
    return newZone;
  }

  return null;
}

// ─────────────────────────────────────────────
// Zone Queries
// ─────────────────────────────────────────────

/**
 * Get all player IDs in a specific zone.
 *
 * @param {string} zoneId - Zone ID to query
 * @returns {string[]} Array of player IDs in the zone
 */
function getZonePlayers(zoneId) {
  if (!zonePlayers[zoneId]) return [];
  return Array.from(zonePlayers[zoneId]);
}

/**
 * Get the number of players in a specific zone.
 *
 * @param {string} zoneId - Zone ID to query
 * @returns {number} Player count
 */
function getZonePlayerCount(zoneId) {
  if (!zonePlayers[zoneId]) return 0;
  return zonePlayers[zoneId].size;
}

/**
 * Get a summary of all zones and their player counts.
 * Useful for debugging and load balancing.
 *
 * @returns {object} Map of zone IDs to player counts
 */
function getZoneSummary() {
  const summary = {};
  for (const [zoneId, players] of Object.entries(zonePlayers)) {
    summary[zoneId] = players.size;
  }
  return summary;
}

module.exports = {
  assignPlayerToZone,
  removePlayerFromZone,
  checkZoneTransfer,
  getZoneForPosition,
  getZonePlayers,
  getZonePlayerCount,
  getZoneSummary,
};
