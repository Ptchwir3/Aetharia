// Shared/Utils/constants.js
//
// AETHARIA — Shared Constants
// ================================
// Central configuration for all Aetharia services.
// Uses CommonJS (module.exports) so it works in both
// Backend and AI_Agents without build tools.
//
// Any value that might differ per deployment can be
// overridden via environment variables where noted.

// ─────────────────────────────────────────────
// World Configuration
// ─────────────────────────────────────────────
// The world is divided into chunks, each chunk is a grid of tiles.
// Chunks are generated procedurally and loaded on demand as
// players move through the world.

const WORLD = {
  // Each chunk is CHUNK_SIZE x CHUNK_SIZE tiles.
  // 32x32 = 1024 tiles per chunk — small enough to generate
  // quickly, large enough to avoid excessive chunk loading.
  CHUNK_SIZE: 32,

  // Pixel dimensions of each tile when rendered.
  // The frontend uses this to convert tile coords to screen coords.
  TILE_SIZE: 32,

  // Global seed for terrain generation.
  // Same seed = same world everywhere, which is essential for
  // a distributed system where different nodes generate chunks
  // independently but must produce identical results.
  SEED: parseInt(process.env.AETHARIA_WORLD_SEED, 10) || 12345,

  // Tile types used by the terrain generator.
  // These are integers stored in the chunk arrays.
  // The frontend maps these to sprites/colors.
  TILES: {
    AIR: 0,         // Empty space — sky, caves
    DIRT: 1,        // Standard ground
    STONE: 2,       // Deep underground
    GRASS: 3,       // Surface layer (top of dirt)
    WATER: 4,       // Lakes, oceans
    SAND: 5,        // Beaches, deserts
    WOOD: 6,        // Trees
    LEAVES: 7,      // Tree canopy
  },
};

// ─────────────────────────────────────────────
// Zone Configuration
// ─────────────────────────────────────────────
// Zones are spatial regions of the world. Each zone can be
// managed by a different server/pod in the cluster.
// Players are assigned to zones based on their position.
//
// Zone boundaries are defined in chunk coordinates, not pixels.
// A zone "owns" a rectangular region of chunks.

const ZONES = {
  // Zone definitions: each zone has a boundary in chunk coords.
  // When a player's chunk position falls within a zone's bounds,
  // they belong to that zone.
  DEFINITIONS: {
    zone_central: { minX: -4, maxX: 3, minY: -4, maxY: 3 },
    zone_north: { minX: -4, maxX: 3, minY: -12, maxY: -5 },
    zone_south: { minX: -4, maxX: 3, minY: 4, maxY: 11 },
    zone_east: { minX: 4, maxX: 11, minY: -4, maxY: 3 },
    zone_west: { minX: -12, maxX: -5, minY: -4, maxY: 3 },
  },

  // The default zone for players whose position doesn't fall
  // within any defined zone boundary.
  DEFAULT: 'zone_central',
};

// ─────────────────────────────────────────────
// Player Configuration
// ─────────────────────────────────────────────

const PLAYER = {
  // Default spawn position (in tile coordinates).
  SPAWN_X: 0,
  SPAWN_Y: 0,

  // Movement speed (tiles per second).
  // The server validates that players don't move faster than this.
  MAX_SPEED: 200,

  // Maximum distance (in tiles) a player can move in a single
  // update message. Anything beyond this is rejected as cheating
  // or a glitch. Calculated from MAX_SPEED and expected update rate.
  MAX_MOVE_DELTA: 20,

  // Maximum inventory size.
  MAX_INVENTORY: 36,
};

// ─────────────────────────────────────────────
// Server Configuration
// ─────────────────────────────────────────────

const SERVER = {
  // How often (in ms) the server pings clients to check if
  // they're still alive. Clients that don't respond before
  // the next heartbeat are terminated.
  HEARTBEAT_INTERVAL: parseInt(process.env.AETHARIA_HEARTBEAT, 10) || 30000,

  // Maximum players per zone before the server should warn
  // or start load balancing. Not enforced yet, but planned.
  MAX_PLAYERS_PER_ZONE: 100,

  // Rate limit: minimum milliseconds between messages from
  // a single client. Messages arriving faster are dropped.
  MIN_MESSAGE_INTERVAL: 50,
};

// ─────────────────────────────────────────────
// Message Types
// ─────────────────────────────────────────────
// Centralized list of all message types so both backend
// and frontend reference the same strings.
// Prevents typo bugs like 'playerMoved' vs 'player_moved'.

const MSG = {
  // Server → Client
  WELCOME: 'welcome',
  PLAYER_JOINED: 'playerJoined',
  PLAYER_LEFT: 'playerLeft',
  PLAYER_MOVED: 'playerMoved',
  EXISTING_PLAYERS: 'existingPlayers',
  CHUNK_DATA: 'chunkData',
  CHAT_MESSAGE: 'chatMessage',
  BLOCK_UPDATE: 'blockUpdate',   // A block was placed or removed
  ERROR: 'error',

  // Client → Server
  MOVE: 'move',
  REQUEST_CHUNK: 'requestChunk',
  CHAT: 'chat',
  INTERACT: 'interact',
  PLACE_BLOCK: 'placeBlock',     // Place a block in the world
  REMOVE_BLOCK: 'removeBlock',   // Remove (mine) a block from the world
  SET_PROFILE: 'setProfile',     // Set player name and color
};

// ─────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────

module.exports = {
  WORLD,
  ZONES,
  PLAYER,
  SERVER,
  MSG,
};
