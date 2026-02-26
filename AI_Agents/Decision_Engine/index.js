// AI_Agents/Decision_Engine/index.js
//
// AETHARIA — AI Decision Engine
// ================================
// Decides what an agent should do on each tick based on:
//   - Personality type (explorer, builder, architect)
//   - Current world knowledge (from memory)
//   - Current position and state
//   - Time (tick count)
//
// Returns action objects like:
//   { type: 'move', x: 5, y: 3 }
//   { type: 'placeBlock', x: 10, y: -2, tile: 2 }
//   { type: 'chat', message: 'Hello!' }
//   { type: 'requestChunk', chunkX: 1, chunkY: 0 }

// Tile types (must match server constants)
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

const CHUNK_SIZE = 32;

class DecisionEngine {
  constructor(personality, memory) {
    this.personality = personality;
    this.memory = memory;

    // Current goal state
    this.currentGoal = null;
    this.goalProgress = 0;
    this.goalSteps = [];

    // Movement target
    this.targetX = null;
    this.targetY = null;

    // Building state
    this.buildingProject = null;
    this.buildQueue = [];

    // Exploration direction
    this.exploreDirection = this.randomDirection();
    this.exploreTicks = 0;
  }

  /**
   * Main decision function — called every tick.
   * Returns an action object or null (do nothing).
   *
   * @param {object} state - Current agent state
   * @returns {object|null} Action to take
   */
  decide(state) {
    const { x, y, tickCount, knownChunks } = state;

    // ── Phase 1: First 10 ticks — just explore and get bearings ──
    if (tickCount < 10) {
      return this.decideExplore(state);
    }

    // ── Phase 2: Execute building queue if we have one ──
    if (this.buildQueue.length > 0) {
      return this.executeBuildStep(state);
    }

    // ── Phase 3: Personality-driven decisions ──
    switch (this.personality) {
      case 'architect':
        return this.decideArchitect(state);
      case 'explorer':
        return this.decideExplorer(state);
      case 'builder':
        return this.decideBuilder(state);
      default:
        return this.decideExplore(state);
    }
  }

  // ─────────────────────────────────────────────
  // Architect Personality
  // ─────────────────────────────────────────────
  // Plans and builds structures: watchtowers, shelters,
  // paths, and bridges. Alternates between exploring to
  // find good spots and building.

  decideArchitect(state) {
    const { tickCount } = state;

    // Every 60 ticks, plan a new structure
    if (tickCount % 60 === 0 && this.buildQueue.length === 0) {
      this.planStructure(state);
      if (this.buildQueue.length > 0) {
        return { type: 'chat', message: this.getBuildAnnouncement() };
      }
    }

    // Every 120 ticks, chat about what we see
    if (tickCount % 120 === 0) {
      return this.randomChat(state);
    }

    // Default: explore
    return this.decideExplore(state);
  }

  // ─────────────────────────────────────────────
  // Explorer Personality
  // ─────────────────────────────────────────────
  // Focuses on movement and discovery. Covers lots of
  // ground, requests new chunks, occasionally leaves
  // trail markers.

  decideExplorer(state) {
    const { tickCount } = state;

    // Every 80 ticks, change direction
    if (tickCount % 80 === 0) {
      this.exploreDirection = this.randomDirection();
    }

    // Every 100 ticks, chat
    if (tickCount % 100 === 0) {
      return this.randomChat(state);
    }

    // Every 40 ticks, leave a trail marker (sand block)
    if (tickCount % 40 === 0) {
      const markerPos = this.memory.findSurfaceAt(Math.round(state.x));
      if (markerPos !== null) {
        return { type: 'placeBlock', x: Math.round(state.x), y: markerPos - 1, tile: TILES.SAND };
      }
    }

    // Request chunks in our direction of travel
    if (tickCount % 20 === 0) {
      const chunkX = Math.floor(state.x / CHUNK_SIZE) + this.exploreDirection.dx * 2;
      const chunkY = Math.floor(state.y / CHUNK_SIZE) + this.exploreDirection.dy * 2;
      return { type: 'requestChunk', chunkX, chunkY };
    }

    return this.decideExplore(state);
  }

  // ─────────────────────────────────────────────
  // Builder Personality
  // ─────────────────────────────────────────────
  // Focused on construction. Builds more frequently
  // and with more variety than the architect.

  decideBuilder(state) {
    const { tickCount } = state;

    // Every 40 ticks, plan something
    if (tickCount % 40 === 0 && this.buildQueue.length === 0) {
      this.planStructure(state);
      if (this.buildQueue.length > 0) {
        return { type: 'chat', message: this.getBuildAnnouncement() };
      }
    }

    // Every 80 ticks, chat
    if (tickCount % 80 === 0) {
      return this.randomChat(state);
    }

    return this.decideExplore(state);
  }

  // ─────────────────────────────────────────────
  // Exploration Movement
  // ─────────────────────────────────────────────

  decideExplore(state) {
    this.exploreTicks++;

    // Change direction periodically
    if (this.exploreTicks % 50 === 0) {
      this.exploreDirection = this.randomDirection();
    }

    const newX = state.x + this.exploreDirection.dx * 2;
    const newY = state.y + this.exploreDirection.dy * 0.5;

    return { type: 'move', x: newX, y: newY };
  }

  // ─────────────────────────────────────────────
  // Structure Planning
  // ─────────────────────────────────────────────
  // Creates a build queue of block placements that
  // form recognizable structures.

  planStructure(state) {
    const baseX = Math.round(state.x);
    const surfaceY = this.memory.findSurfaceAt(baseX);

    if (surfaceY === null) {
      // Don't know the surface here, explore more
      return;
    }

    const structures = [
      () => this.planWatchtower(baseX, surfaceY),
      () => this.planShelter(baseX, surfaceY),
      () => this.planPath(baseX, surfaceY),
      () => this.planStaircase(baseX, surfaceY),
      () => this.planWall(baseX, surfaceY),
      () => this.planPlatform(baseX, surfaceY),
    ];

    // Pick a random structure to build
    const planner = structures[Math.floor(Math.random() * structures.length)];
    planner();
  }

  planWatchtower(baseX, surfaceY) {
    const blocks = [];
    // Stone pillar, 6 blocks tall
    for (let dy = 1; dy <= 6; dy++) {
      blocks.push({ x: baseX, y: surfaceY - dy, tile: TILES.STONE });
    }
    // Platform on top (3 wide)
    for (let dx = -1; dx <= 1; dx++) {
      blocks.push({ x: baseX + dx, y: surfaceY - 7, tile: TILES.STONE });
    }
    this.buildQueue = blocks;
    this.buildingProject = 'watchtower';
  }

  planShelter(baseX, surfaceY) {
    const blocks = [];
    // Floor (5 wide)
    for (let dx = 0; dx < 5; dx++) {
      blocks.push({ x: baseX + dx, y: surfaceY, tile: TILES.STONE });
    }
    // Walls (3 tall on each side)
    for (let dy = 1; dy <= 3; dy++) {
      blocks.push({ x: baseX, y: surfaceY - dy, tile: TILES.WOOD });
      blocks.push({ x: baseX + 4, y: surfaceY - dy, tile: TILES.WOOD });
    }
    // Roof (5 wide)
    for (let dx = 0; dx < 5; dx++) {
      blocks.push({ x: baseX + dx, y: surfaceY - 4, tile: TILES.WOOD });
    }
    this.buildQueue = blocks;
    this.buildingProject = 'shelter';
  }

  planPath(baseX, surfaceY) {
    const blocks = [];
    // 15-block stone path along the surface
    for (let dx = 0; dx < 15; dx++) {
      const sy = this.memory.findSurfaceAt(baseX + dx);
      if (sy !== null) {
        blocks.push({ x: baseX + dx, y: sy, tile: TILES.STONE });
      }
    }
    this.buildQueue = blocks;
    this.buildingProject = 'stone path';
  }

  planStaircase(baseX, surfaceY) {
    const blocks = [];
    // Staircase going down (8 steps)
    for (let i = 0; i < 8; i++) {
      blocks.push({ x: baseX + i, y: surfaceY + i, tile: TILES.STONE });
      // Remove block above for headroom
      blocks.push({ x: baseX + i, y: surfaceY + i - 1, tile: TILES.AIR });
      blocks.push({ x: baseX + i, y: surfaceY + i - 2, tile: TILES.AIR });
    }
    this.buildQueue = blocks;
    this.buildingProject = 'staircase to underground';
  }

  planWall(baseX, surfaceY) {
    const blocks = [];
    // Stone wall, 10 wide, 4 tall
    for (let dx = 0; dx < 10; dx++) {
      for (let dy = 1; dy <= 4; dy++) {
        blocks.push({ x: baseX + dx, y: surfaceY - dy, tile: TILES.STONE });
      }
    }
    this.buildQueue = blocks;
    this.buildingProject = 'defensive wall';
  }

  planPlatform(baseX, surfaceY) {
    const blocks = [];
    // Elevated platform: 4 pillars + flat top
    const height = 5;
    // Pillars
    for (let dy = 1; dy <= height; dy++) {
      blocks.push({ x: baseX, y: surfaceY - dy, tile: TILES.STONE });
      blocks.push({ x: baseX + 6, y: surfaceY - dy, tile: TILES.STONE });
    }
    // Platform
    for (let dx = 0; dx <= 6; dx++) {
      blocks.push({ x: baseX + dx, y: surfaceY - height - 1, tile: TILES.WOOD });
    }
    this.buildQueue = blocks;
    this.buildingProject = 'elevated platform';
  }

  // ─────────────────────────────────────────────
  // Build Execution
  // ─────────────────────────────────────────────

  executeBuildStep(state) {
    if (this.buildQueue.length === 0) return null;

    const step = this.buildQueue.shift();

    // Move toward the build site if we're far away
    const dist = Math.abs(step.x - state.x) + Math.abs(step.y - state.y);
    if (dist > 40) {
      // Too far, move closer first
      this.buildQueue.unshift(step); // Put it back
      return { type: 'move', x: step.x, y: step.y };
    }

    // Place or remove the block
    if (step.tile === TILES.AIR) {
      return { type: 'removeBlock', x: step.x, y: step.y };
    }
    return { type: 'placeBlock', x: step.x, y: step.y, tile: step.tile };
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  randomDirection() {
    const directions = [
      { dx: 1, dy: 0 },   // East
      { dx: -1, dy: 0 },  // West
      { dx: 1, dy: 1 },   // Southeast
      { dx: -1, dy: 1 },  // Southwest
      { dx: 1, dy: -1 },  // Northeast
      { dx: -1, dy: -1 }, // Northwest
    ];
    return directions[Math.floor(Math.random() * directions.length)];
  }

  randomChat(state) {
    // Pull from the agent's personality chat messages
    // (these are passed in from the profile in index.js via the agent)
    return null; // Chat is triggered from the Agent class directly
  }

  getBuildAnnouncement() {
    const announcements = {
      'watchtower': 'Building a watchtower to survey the land!',
      'shelter': 'Constructing a shelter for weary travelers.',
      'stone path': 'Laying a stone path through the terrain.',
      'staircase to underground': 'Carving stairs down to the caves below.',
      'defensive wall': 'Raising a stone wall here.',
      'elevated platform': 'Building an elevated platform for a better view.',
    };
    return announcements[this.buildingProject] || `Building a ${this.buildingProject}...`;
  }
}

module.exports = { DecisionEngine };
