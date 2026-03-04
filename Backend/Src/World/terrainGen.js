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
      // Trees only grow on grass — not on sand, water, or air.
      // Check surface type before placing.
      if (tile === T.AIR && depth < 0 && depth >= -6) {
        // Only place tree if the surface at this X is grass
        const surfaceTileDepth = 0;
        const seaLevel = -2;
        const isGrassSurface = surfaceY <= seaLevel && Math.abs(surfaceY - seaLevel) > 2;

        // Simpler check: surface must be above sea level with margin
        const surfaceAboveWater = surfaceY < seaLevel - 1;

        if (surfaceAboveWater) {
          const treeSeed = mulberry32(chunkSeed(worldX, 0));
          const treeChance = treeSeed();

          // Space trees out — also check neighbors don't have trees
          const neighborSeed1 = mulberry32(chunkSeed(worldX - 1, 0))();
          const neighborSeed2 = mulberry32(chunkSeed(worldX + 1, 0))();
          const neighborsHaveTree = neighborSeed1 > 0.85 || neighborSeed2 > 0.85;

          if (treeChance > 0.88 && !neighborsHaveTree) {
            const trunkHeight = 3 + Math.floor(treeSeed() * 2); // 3-4 tall
            const trunkTop = surfaceY - trunkHeight;
            const trunkBottom = surfaceY - 1;

            if (worldY >= trunkTop && worldY <= trunkBottom) {
              tile = T.WOOD;
            }

            // Leaves: 3-wide canopy, 2 tiles tall
            const leavesTop = trunkTop - 1;
            const leavesBottom = trunkTop;
            if (worldY >= leavesTop && worldY <= leavesBottom) {
              // Center column and neighbors get leaves
              tile = T.LEAVES;
            }
            // Side leaves (check if we're 1 tile left or right of a tree trunk)
            const leftTreeSeed = mulberry32(chunkSeed(worldX - 1, 0))();
            const rightTreeSeed = mulberry32(chunkSeed(worldX + 1, 0))();
            // Check if adjacent X has a tree and we're at canopy height
            if (worldY === leavesTop || worldY === leavesBottom) {
              const checkX = worldX;
              for (let tx = -1; tx <= 1; tx++) {
                const adjSeed = mulberry32(chunkSeed(worldX + tx, 0));
                const adjChance = adjSeed();
                const adjNeighbor1 = mulberry32(chunkSeed(worldX + tx - 1, 0))();
                const adjNeighbor2 = mulberry32(chunkSeed(worldX + tx + 1, 0))();
                const adjNoNeighborTree = !(adjNeighbor1 > 0.88) && !(adjNeighbor2 > 0.88);
                if (tx !== 0 && adjChance > 0.88 && adjNoNeighborTree) {
                  const adjSurface = Math.floor(-8 + surfaceNoise(worldX + tx, rng) * 16);
                  const adjAboveWater = adjSurface < seaLevel - 1;
                  if (adjAboveWater) {
                    const adjTrunkHeight = 3 + Math.floor(adjSeed() * 2);
                    const adjTrunkTop = adjSurface - adjTrunkHeight;
                    const adjLeavesTop = adjTrunkTop - 1;
                    const adjLeavesBottom = adjTrunkTop;
                    if (worldY >= adjLeavesTop && worldY <= adjLeavesBottom) {
                      tile = T.LEAVES;
                    }
                  }
                }
              }
            }
          }
        }
      }

      // ── Underground variety ──
      // Deeper = rarer materials and bigger caves
      if (depth > 8 && tile === T.STONE) {
        const caveRoll = rng();
        const oreRoll = rng();

        // Cave frequency increases with depth (8% base, up to 15% deep)
        const caveChance = 0.08 + Math.min(depth / 500, 0.07);
        if (caveRoll < caveChance) {
          tile = T.AIR;
        }

        // Ore deposits (diamond/ice = cyan blocks) deep underground
        if (tile === T.STONE && depth > 20 && oreRoll < 0.03) {
          tile = T.WATER; // Using water tile as "crystal/ore" visually (cyan)
        }

        // Sand pockets (gold veins) at medium depth
        if (tile === T.STONE && depth > 12 && depth < 40 && oreRoll > 0.95) {
          tile = T.SAND; // Gold-colored deposits
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
