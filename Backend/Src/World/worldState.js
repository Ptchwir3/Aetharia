// Backend/Src/World/worldState.js
//
// AETHARIA — World State Store
// ================================
// Tracks modifications to the procedurally generated world.
// The terrain generator produces the "base" world, and this
// module stores any changes made on top of it (blocks placed,
// blocks removed, structures built).
//
// Architecture:
//   - Base terrain comes from terrainGen.js (deterministic, never changes)
//   - Modifications are stored here as overrides
//   - When a client requests a chunk, the server merges the
//     base terrain with any modifications
//   - Modifications persist in memory (future: save to disk/Redis)
//
// This is what allows the world to evolve — AI agents build
// structures, players mine blocks, and those changes persist
// for everyone.

const { WORLD } = require('../Utils/constants');
const { generateChunk } = require('./terrainGen');
const log = require('../Utils/logger');

// ─────────────────────────────────────────────
// Modification Store
// ─────────────────────────────────────────────
// Key: "worldX,worldY" (tile coordinates)
// Value: tile type integer (from WORLD.TILES)
//
// Only modified tiles are stored. Unmodified tiles are
// served from the terrain generator.

const modifications = new Map();

/**
 * Place a block at a world tile position.
 * Overrides whatever was there (generated terrain or previous modification).
 *
 * @param {number} worldX - Tile X coordinate
 * @param {number} worldY - Tile Y coordinate
 * @param {number} tileType - Tile type from WORLD.TILES
 * @returns {boolean} true if placed successfully
 */
function placeBlock(worldX, worldY, tileType) {
  if (!Number.isInteger(worldX) || !Number.isInteger(worldY)) return false;
  if (!Number.isInteger(tileType) || tileType < 0 || tileType > 7) return false;

  const key = `${worldX},${worldY}`;
  modifications.set(key, tileType);
  return true;
}

/**
 * Remove a block at a world tile position (set it to AIR).
 *
 * @param {number} worldX - Tile X coordinate
 * @param {number} worldY - Tile Y coordinate
 * @returns {boolean} true if removed successfully
 */
function removeBlock(worldX, worldY) {
  return placeBlock(worldX, worldY, WORLD.TILES.AIR);
}

/**
 * Get the tile at a world position, accounting for modifications.
 * If the tile has been modified, returns the modification.
 * Otherwise, generates the base terrain tile.
 *
 * @param {number} worldX - Tile X coordinate
 * @param {number} worldY - Tile Y coordinate
 * @returns {number} Tile type
 */
function getTile(worldX, worldY) {
  const key = `${worldX},${worldY}`;
  if (modifications.has(key)) {
    return modifications.get(key);
  }

  // Fall back to generated terrain
  const chunkX = Math.floor(worldX / WORLD.CHUNK_SIZE);
  const chunkY = Math.floor(worldY / WORLD.CHUNK_SIZE);
  const localX = ((worldX % WORLD.CHUNK_SIZE) + WORLD.CHUNK_SIZE) % WORLD.CHUNK_SIZE;
  const localY = ((worldY % WORLD.CHUNK_SIZE) + WORLD.CHUNK_SIZE) % WORLD.CHUNK_SIZE;

  const chunk = generateChunk(chunkX, chunkY);
  return chunk.tiles[localY][localX];
}

/**
 * Get a chunk with modifications applied.
 * Generates the base chunk, then overlays any modifications.
 *
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkY - Chunk Y coordinate
 * @returns {object} Chunk data with modifications applied
 */
function getModifiedChunk(chunkX, chunkY) {
  const chunk = generateChunk(chunkX, chunkY);

  // Apply any modifications within this chunk's bounds
  const startX = chunkX * WORLD.CHUNK_SIZE;
  const startY = chunkY * WORLD.CHUNK_SIZE;

  for (let ly = 0; ly < WORLD.CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < WORLD.CHUNK_SIZE; lx++) {
      const key = `${startX + lx},${startY + ly}`;
      if (modifications.has(key)) {
        chunk.tiles[ly][lx] = modifications.get(key);
      }
    }
  }

  return chunk;
}

/**
 * Get all modifications within a chunk (for delta updates).
 * Returns only the modified tiles, not the full chunk.
 *
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkY - Chunk Y coordinate
 * @returns {Array} Array of { x, y, tile } modifications
 */
function getChunkModifications(chunkX, chunkY) {
  const startX = chunkX * WORLD.CHUNK_SIZE;
  const startY = chunkY * WORLD.CHUNK_SIZE;
  const endX = startX + WORLD.CHUNK_SIZE;
  const endY = startY + WORLD.CHUNK_SIZE;
  const mods = [];

  for (const [key, tile] of modifications) {
    const [x, y] = key.split(',').map(Number);
    if (x >= startX && x < endX && y >= startY && y < endY) {
      mods.push({ x, y, tile });
    }
  }

  return mods;
}

/**
 * Get total number of modifications (for stats/debugging).
 * @returns {number}
 */
function getModificationCount() {
  return modifications.size;
}

module.exports = {
  placeBlock,
  removeBlock,
  getTile,
  getModifiedChunk,
  getChunkModifications,
  getModificationCount,
};
