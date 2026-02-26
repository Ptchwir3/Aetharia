// Backend/Src/World/terrainGen.js
//
// AETHARIA — Procedural Terrain Generator
// =========================================
// Generates terrain chunks deterministically from a global seed.
// This is critical for a distributed system: any node in the
// cluster must produce the exact same chunk for the same
// coordinates without needing to communicate with other nodes.
//
// Terrain style: Terraria-inspired 2D side-view world.
//   - Sky at the top (AIR)
//   - Surface layer with GRASS on top of DIRT
//   - STONE deeper underground
//   - Trees on the surface (WOOD trunks, LEAVES canopy)
//   - WATER in low-lying areas
//   - SAND near water edges
//
// The generator uses a simple seeded PRNG (not Math.random())
// so results are reproducible. For the MVP, we use a basic
// noise function. This can be upgraded to Perlin/Simplex later
// without changing the chunk format.

const { WORLD } = require('../Utils/constants');

// ─────────────────────────────────────────────
// Seeded Pseudo-Random Number Generator
// ─────────────────────────────────────────────
// Simple but fast mulberry32 PRNG. Given the same seed,
// it always produces the same sequence of numbers.
// This replaces Math.random() everywhere in terrain gen.

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────
// Seed Hashing
// ─────────────────────────────────────────────
// Creates a unique seed for each chunk based on the global
// world seed and the chunk's coordinates. This ensures:
//   - Same chunk coords + same world seed = same terrain
//   - Different chunks get different terrain
//   - Changing the world seed changes everything

function chunkSeed(chunkX, chunkY) {
  // Combine world seed with chunk position using prime multipliers
  // to avoid collisions between (1,2) and (2,1) etc.
  let hash = WORLD.SEED;
  hash = ((hash << 5) - hash + (chunkX * 374761393)) | 0;
  hash = ((hash << 5) - hash + (chunkY * 668265263)) | 0;
  return Math.abs(hash);
}

// ─────────────────────────────────────────────
// Simple 1D Noise (for surface height)
// ─────────────────────────────────────────────
// Generates a smooth height value for a given world X position.
// Uses multiple octaves of noise for natural-looking terrain.
// Returns a value roughly between 0 and 1.

function surfaceNoise(worldX, rng) {
  // Use the worldX to create a pseudo-noise value
  // We sample at different frequencies and combine them
  const freq1 = Math.sin(worldX * 0.05) * 0.5 + 0.5;
  const freq2 = Math.sin(worldX * 0.13 + 42) * 0.25 + 0.25;
  const freq3 = Math.sin(worldX * 0.31 + 97) * 0.125 + 0.125;

  return (freq1 + freq2 + freq3) / 3;
}

// ─────────────────────────────────────────────
// Chunk Generator
// ─────────────────────────────────────────────
// Generates a single chunk of terrain at the given chunk
// coordinates. Returns a 2D array of tile IDs.
//
// The chunk is CHUNK_SIZE x CHUNK_SIZE tiles.
// Index as: tiles[y][x] where y=0 is the top of the chunk.
//
// World coordinate conversion:
//   worldTileX = chunkX * CHUNK_SIZE + localX
//   worldTileY = chunkY * CHUNK_SIZE + localY

/**
 * Generate a terrain chunk at the specified chunk coordinates.
 *
 * @param {number} chunkX - Chunk X coordinate (not tile coordinate)
 * @param {number} chunkY - Chunk Y coordinate (not tile coordinate)
 * @returns {object} Chunk data: { x, y, tiles[][] }
 *
 * @example
 *   const chunk = generateChunk(0, 0);
 *   // chunk.tiles[y][x] gives the tile type at that position
 *   // chunk.x and chunk.y echo back the chunk coordinates
 */
function generateChunk(chunkX, chunkY) {
  const seed = chunkSeed(chunkX, chunkY);
  const rng = mulberry32(seed);
  const size = WORLD.CHUNK_SIZE;
  const T = WORLD.TILES;

  const tiles = [];

  for (let localY = 0; localY < size; localY++) {
    const row = [];
    const worldY = chunkY * size + localY;

    for (let localX = 0; localX < size; localX++) {
      const worldX = chunkX * size + localX;

      // ── Calculate surface height ──
      // Surface height is a function of worldX only (consistent
      // across vertical chunks at the same X).
      // We map noise (0-1) to a world Y range.
      // Surface sits around worldY = 0 with variation of ±8 tiles.
      const noiseVal = surfaceNoise(worldX, rng);
      const surfaceY = Math.floor(-8 + noiseVal * 16);

      // ── Determine tile type based on depth ──
      const depth = worldY - surfaceY;

      let tile;
      if (depth < 0) {
        // Above surface = air
        tile = T.AIR;
      } else if (depth === 0) {
        // Exactly at surface = grass
        tile = T.GRASS;
      } else if (depth <= 4) {
        // Just below surface = dirt
        tile = T.DIRT;
      } else {
        // Deep underground = stone
        tile = T.STONE;
      }

      // ── Water in low areas ──
      // If we're above the surface but below sea level (worldY > -2),
      // fill with water. Creates lakes in valleys.
      const seaLevel = -2;
      if (tile === T.AIR && worldY > seaLevel) {
        tile = T.WATER;
      }

      // ── Sand near water ──
      // If this is a grass/dirt tile adjacent to where water would be,
      // replace with sand for a beach effect.
      if ((tile === T.GRASS || tile === T.DIRT) && depth <= 1) {
        const neighborSurface = Math.floor(-8 + surfaceNoise(worldX + 1, rng) * 16);
        if (neighborSurface > seaLevel || surfaceY > seaLevel) {
          // Near a low point, make it sandy
          if (Math.abs(surfaceY - seaLevel) <= 2) {
            tile = T.SAND;
          }
        }
      }

      // ── Trees ──
      // Place trees on grass tiles with seeded randomness.
      // Trees are: WOOD trunk (2-4 tiles tall) with LEAVES on top.
      // We only place trees based on the worldX position to keep
      // them deterministic across chunk boundaries.
      if (tile === T.AIR && depth < 0 && depth >= -5) {
        // Check if there should be a tree at this X
        const treeSeed = mulberry32(chunkSeed(worldX, 0));
        const treeChance = treeSeed();
        if (treeChance > 0.85) {
          // This X has a tree. Trunk goes from surface-1 to surface-4.
          const trunkTop = surfaceY - 4;
          const trunkBottom = surfaceY - 1;

          if (worldY >= trunkTop && worldY <= trunkBottom) {
            tile = T.WOOD;
          }

          // Leaves above trunk (simple 3-wide canopy)
          const leavesY = trunkTop - 1;
          if (worldY === leavesY) {
            tile = T.LEAVES;
          }
        }
      }

      // ── Underground caves ──
      // Simple cave generation using the RNG. About 8% of deep
      // stone tiles are hollowed out into air pockets.
      if (tile === T.STONE && depth > 8) {
        const caveRoll = rng();
        if (caveRoll < 0.08) {
          tile = T.AIR;
        }
      }

      row.push(tile);
    }

    tiles.push(row);
  }

  return {
    x: chunkX,
    y: chunkY,
    tiles,
  };
}

module.exports = {
  generateChunk,
};
