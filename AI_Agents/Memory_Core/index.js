// AI_Agents/Memory_Core/index.js
//
// AETHARIA — AI Memory Core
// ================================
// Stores an agent's knowledge of the world. As the agent
// receives chunk data and observes block changes, it builds
// up a mental model of the terrain.
//
// Key capabilities:
//   - Remember terrain from chunks (surface heights, tile types)
//   - Track block modifications (placed/removed by anyone)
//   - Find the surface level at any known X coordinate
//   - Know what tiles are at specific positions
//   - Track explored vs unexplored areas

const CHUNK_SIZE = 32;

// Tile types
const TILES = {
  AIR: 0,
  DIRT: 1,
  STONE: 2,
  GRASS: 3,
  WATER: 4,
  SAND: 5,
  WOOD: 6,
  LEAVES: 7,
};

class MemoryCore {
  constructor(agentName) {
    this.agentName = agentName;

    // Surface height map: worldX → worldY of the first solid block
    // This is the most important piece of terrain knowledge —
    // it tells the agent where the ground is at any X position.
    this.surfaceMap = new Map();

    // Known tiles: "worldX,worldY" → tile type
    // Sparse storage — only stores tiles we've actually seen
    // or that have been modified.
    this.knownTiles = new Map();

    // Block modifications we've observed
    this.modifications = [];

    // Explored chunks
    this.exploredChunks = new Set();

    // Stats
    this.totalTilesKnown = 0;
  }

  /**
   * Process and remember a chunk of terrain data.
   * Extracts surface heights and stores tile knowledge.
   *
   * @param {object} chunk - { x, y, tiles[][] }
   */
  rememberChunk(chunk) {
    if (!chunk || !chunk.tiles) return;

    const key = `${chunk.x},${chunk.y}`;
    if (this.exploredChunks.has(key)) return;
    this.exploredChunks.add(key);

    const startX = chunk.x * CHUNK_SIZE;
    const startY = chunk.y * CHUNK_SIZE;

    for (let ly = 0; ly < chunk.tiles.length; ly++) {
      for (let lx = 0; lx < chunk.tiles[ly].length; lx++) {
        const worldX = startX + lx;
        const worldY = startY + ly;
        const tile = chunk.tiles[ly][lx];

        // Store tile knowledge
        const tileKey = `${worldX},${worldY}`;
        this.knownTiles.set(tileKey, tile);
        this.totalTilesKnown++;

        // Update surface map — surface is the first non-AIR tile
        // scanning from top to bottom
        if (tile !== TILES.AIR && tile !== TILES.WATER) {
          const currentSurface = this.surfaceMap.get(worldX);
          if (currentSurface === undefined || worldY < currentSurface) {
            this.surfaceMap.set(worldX, worldY);
          }
        }
      }
    }

    console.log(`🧠 [${this.agentName}] Memorized chunk (${chunk.x}, ${chunk.y}) — ${this.totalTilesKnown} tiles known, ${this.surfaceMap.size} surface points`);
  }

  /**
   * Remember a block change (from blockUpdate messages).
   *
   * @param {number} worldX
   * @param {number} worldY
   * @param {number} tile - New tile type
   */
  rememberBlockChange(worldX, worldY, tile) {
    const key = `${worldX},${worldY}`;
    this.knownTiles.set(key, tile);

    // Update surface map if this affects it
    if (tile !== TILES.AIR && tile !== TILES.WATER) {
      const currentSurface = this.surfaceMap.get(worldX);
      if (currentSurface === undefined || worldY < currentSurface) {
        this.surfaceMap.set(worldX, worldY);
      }
    } else if (tile === TILES.AIR) {
      // If we removed a surface block, the surface might be lower now
      const currentSurface = this.surfaceMap.get(worldX);
      if (currentSurface === worldY) {
        // Find the new surface below
        for (let y = worldY + 1; y < worldY + 20; y++) {
          const belowTile = this.knownTiles.get(`${worldX},${y}`);
          if (belowTile !== undefined && belowTile !== TILES.AIR && belowTile !== TILES.WATER) {
            this.surfaceMap.set(worldX, y);
            return;
          }
        }
        // No solid tile found, remove surface entry
        this.surfaceMap.delete(worldX);
      }
    }

    this.modifications.push({ x: worldX, y: worldY, tile, time: Date.now() });
  }

  /**
   * Find the surface Y coordinate at a given X position.
   * Returns the Y of the first solid block (the "ground level").
   *
   * @param {number} worldX - X position to query
   * @returns {number|null} Surface Y, or null if unknown
   */
  findSurfaceAt(worldX) {
    return this.surfaceMap.get(worldX) || null;
  }

  /**
   * Get the tile at a specific world position.
   *
   * @param {number} worldX
   * @param {number} worldY
   * @returns {number|null} Tile type, or null if unknown
   */
  getTileAt(worldX, worldY) {
    const key = `${worldX},${worldY}`;
    const tile = this.knownTiles.get(key);
    return tile !== undefined ? tile : null;
  }

  /**
   * Check if a position is solid (not air or water).
   *
   * @param {number} worldX
   * @param {number} worldY
   * @returns {boolean|null} true if solid, false if not, null if unknown
   */
  isSolid(worldX, worldY) {
    const tile = this.getTileAt(worldX, worldY);
    if (tile === null) return null;
    return tile !== TILES.AIR && tile !== TILES.WATER;
  }

  /**
   * Find a flat area suitable for building.
   * Looks for N consecutive X positions with the same surface height.
   *
   * @param {number} centerX - Start searching from here
   * @param {number} width - How many flat tiles we need
   * @returns {object|null} { x, y, width } or null
   */
  findFlatArea(centerX, width) {
    for (let startX = centerX - 20; startX < centerX + 20; startX++) {
      const startY = this.findSurfaceAt(startX);
      if (startY === null) continue;

      let flat = true;
      for (let dx = 1; dx < width; dx++) {
        const sy = this.findSurfaceAt(startX + dx);
        if (sy === null || Math.abs(sy - startY) > 1) {
          flat = false;
          break;
        }
      }

      if (flat) {
        return { x: startX, y: startY, width };
      }
    }
    return null;
  }

  /**
   * Get memory stats for debugging.
   */
  getStats() {
    return {
      tilesKnown: this.totalTilesKnown,
      surfacePoints: this.surfaceMap.size,
      chunksExplored: this.exploredChunks.size,
      modifications: this.modifications.length,
    };
  }
}

module.exports = { MemoryCore };
