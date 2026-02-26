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
// All building is physics-aware: structures must be grounded,
// blocks can only be placed in air, and agents verify the
// surface before planning.

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

const SOLID_TILES = [TILES.DIRT, TILES.STONE, TILES.GRASS, TILES.SAND, TILES.WOOD, TILES.LEAVES];
const CHUNK_SIZE = 32;

class DecisionEngine {
  constructor(personality, memory) {
    this.personality = personality;
    this.memory = memory;

    this.buildingProject = null;
    this.buildQueue = [];

    this.exploreDirection = this.randomHorizontalDirection();
    this.exploreTicks = 0;

    // Cooldowns — prevent constant building
    this.lastBuildTick = 0;
    this.lastChatTick = 0;
    this.structuresBuilt = 0;
  }

  decide(state) {
    const { x, y, tickCount } = state;

    // Phase 1: First 30 ticks — just explore
    if (tickCount < 30) {
      return this.decideExplore(state);
    }

    // Phase 2: Execute build queue one step at a time
    if (this.buildQueue.length > 0) {
      return this.executeBuildStep(state);
    }

    // Phase 3: Personality-driven
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
  // Architect — builds every 300 ticks, max 5 structures
  // ─────────────────────────────────────────────

  decideArchitect(state) {
    const { tickCount } = state;
    const ticksSinceLastBuild = tickCount - this.lastBuildTick;

    if (ticksSinceLastBuild > 300 && this.structuresBuilt < 5) {
      if (this.tryPlanStructure(state)) {
        this.lastBuildTick = tickCount;
        return { type: 'chat', message: this.getBuildAnnouncement() };
      }
    }

    if (tickCount - this.lastChatTick > 250) {
      this.lastChatTick = tickCount;
      return null; // Chat handled by Agent class
    }

    return this.decideExplore(state);
  }

  // ─────────────────────────────────────────────
  // Explorer — mostly moves, rarely builds, requests chunks
  // ─────────────────────────────────────────────

  decideExplorer(state) {
    const { tickCount } = state;

    if (tickCount % 100 === 0) {
      this.exploreDirection = this.randomHorizontalDirection();
    }

    // Request chunks ahead of movement
    if (tickCount % 30 === 0) {
      const chunkX = Math.floor(state.x / CHUNK_SIZE) + this.exploreDirection.dx * 2;
      const chunkY = Math.floor(state.y / CHUNK_SIZE);
      return { type: 'requestChunk', chunkX, chunkY };
    }

    return this.decideExplore(state);
  }

  // ─────────────────────────────────────────────
  // Builder — builds every 200 ticks, max 8 structures
  // ─────────────────────────────────────────────

  decideBuilder(state) {
    const { tickCount } = state;
    const ticksSinceLastBuild = tickCount - this.lastBuildTick;

    if (ticksSinceLastBuild > 200 && this.structuresBuilt < 8) {
      if (this.tryPlanStructure(state)) {
        this.lastBuildTick = tickCount;
        return { type: 'chat', message: this.getBuildAnnouncement() };
      }
    }

    return this.decideExplore(state);
  }

  // ─────────────────────────────────────────────
  // Exploration — walk along the surface horizontally
  // ─────────────────────────────────────────────

  decideExplore(state) {
    this.exploreTicks++;

    if (this.exploreTicks % 60 === 0) {
      this.exploreDirection = this.randomHorizontalDirection();
    }

    // Move horizontally, let the server handle Y (agents don't have gravity
    // but we try to stay near the surface)
    const targetX = state.x + this.exploreDirection.dx * 2;

    // Try to walk along the surface
    const surfaceY = this.memory.findSurfaceAt(Math.round(targetX));
    let targetY = state.y;
    if (surfaceY !== null) {
      targetY = surfaceY - 1; // One tile above ground
    }

    return { type: 'move', x: targetX, y: targetY };
  }

  // ─────────────────────────────────────────────
  // Structure Planning — physics-aware
  // ─────────────────────────────────────────────

  tryPlanStructure(state) {
    const baseX = Math.round(state.x);
    const surfaceY = this.memory.findSurfaceAt(baseX);

    if (surfaceY === null) return false;

    // Verify this is actually a solid surface with air above
    const groundTile = this.memory.getTileAt(baseX, surfaceY);
    const aboveTile = this.memory.getTileAt(baseX, surfaceY - 1);

    if (!SOLID_TILES.includes(groundTile)) return false;
    if (aboveTile !== null && aboveTile !== TILES.AIR) return false;

    // Find a flat area for building
    const flat = this.memory.findFlatArea(baseX, 5);
    if (!flat) return false;

    // Pick a structure appropriate to the terrain
    const structures = [
      () => this.planWatchtower(flat.x, flat.y),
      () => this.planShelter(flat.x, flat.y),
      () => this.planPath(flat.x, flat.y),
    ];

    const planner = structures[Math.floor(Math.random() * structures.length)];
    planner();

    // Validate every block in the queue
    this.buildQueue = this.buildQueue.filter(block => {
      if (block.tile === TILES.AIR) return true; // Removals are fine

      // Only place blocks in air
      const existing = this.memory.getTileAt(block.x, block.y);
      if (existing !== null && existing !== TILES.AIR) return false;

      // Block must be adjacent to a solid tile (grounded)
      const below = this.memory.getTileAt(block.x, block.y + 1);
      const left = this.memory.getTileAt(block.x - 1, block.y);
      const right = this.memory.getTileAt(block.x + 1, block.y);

      const hasSupport = (below !== null && SOLID_TILES.includes(below)) ||
                         (left !== null && SOLID_TILES.includes(left)) ||
                         (right !== null && SOLID_TILES.includes(right));

      return hasSupport;
    });

    if (this.buildQueue.length > 0) {
      this.structuresBuilt++;
      return true;
    }
    return false;
  }

  planWatchtower(baseX, surfaceY) {
    const blocks = [];
    // Stone pillar built from ground up (4 blocks, not 6)
    for (let dy = 1; dy <= 4; dy++) {
      blocks.push({ x: baseX, y: surfaceY - dy, tile: TILES.STONE });
    }
    // Small platform on top (3 wide)
    blocks.push({ x: baseX - 1, y: surfaceY - 5, tile: TILES.STONE });
    blocks.push({ x: baseX, y: surfaceY - 5, tile: TILES.STONE });
    blocks.push({ x: baseX + 1, y: surfaceY - 5, tile: TILES.STONE });

    // Sort bottom-up so each block has support when placed
    blocks.sort((a, b) => b.y - a.y);
    this.buildQueue = blocks;
    this.buildingProject = 'watchtower';
  }

  planShelter(baseX, surfaceY) {
    const blocks = [];
    // Floor (5 wide, at surface)
    for (let dx = 0; dx < 5; dx++) {
      const sy = this.memory.findSurfaceAt(baseX + dx);
      if (sy !== null && Math.abs(sy - surfaceY) <= 1) {
        blocks.push({ x: baseX + dx, y: sy, tile: TILES.STONE });
      }
    }
    // Walls (3 tall on each side)
    for (let dy = 1; dy <= 3; dy++) {
      blocks.push({ x: baseX, y: surfaceY - dy, tile: TILES.WOOD });
      blocks.push({ x: baseX + 4, y: surfaceY - dy, tile: TILES.WOOD });
    }
    // Roof
    for (let dx = 0; dx < 5; dx++) {
      blocks.push({ x: baseX + dx, y: surfaceY - 4, tile: TILES.WOOD });
    }

    // Sort bottom-up
    blocks.sort((a, b) => b.y - a.y);
    this.buildQueue = blocks;
    this.buildingProject = 'shelter';
  }

  planPath(baseX, surfaceY) {
    const blocks = [];
    // 8-block stone path along surface (shorter than before)
    for (let dx = 0; dx < 8; dx++) {
      const sy = this.memory.findSurfaceAt(baseX + dx);
      if (sy !== null && Math.abs(sy - surfaceY) <= 1) {
        blocks.push({ x: baseX + dx, y: sy, tile: TILES.STONE });
      }
    }
    this.buildQueue = blocks;
    this.buildingProject = 'stone path';
  }

  // ─────────────────────────────────────────────
  // Build Execution
  // ─────────────────────────────────────────────

  executeBuildStep(state) {
    if (this.buildQueue.length === 0) return null;

    const step = this.buildQueue[0];

    // Move closer if too far
    const dist = Math.abs(step.x - state.x) + Math.abs(step.y - state.y);
    if (dist > 30) {
      return { type: 'move', x: step.x, y: step.y };
    }

    this.buildQueue.shift();

    if (step.tile === TILES.AIR) {
      return { type: 'removeBlock', x: step.x, y: step.y };
    }
    return { type: 'placeBlock', x: step.x, y: step.y, tile: step.tile };
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  randomHorizontalDirection() {
    // Only move left or right — no diagonal flying
    return Math.random() < 0.5 ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 };
  }

  randomChat(state) {
    return null;
  }

  getBuildAnnouncement() {
    const announcements = {
      'watchtower': 'Building a watchtower to survey the land!',
      'shelter': 'Constructing a shelter for weary travelers.',
      'stone path': 'Laying a stone path through the terrain.',
    };
    return announcements[this.buildingProject] || `Building a ${this.buildingProject}...`;
  }
}

module.exports = { DecisionEngine };
