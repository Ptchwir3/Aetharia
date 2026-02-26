// Backend/Src/Handlers/handleMessage.js
//
// AETHARIA — Message Handler
// ================================
// Routes incoming WebSocket messages to the appropriate handler.
// Server-side gravity means the move handler only accepts
// horizontal input + jump. The server physics loop controls Y.

const { PLAYER, MSG, SERVER, WORLD } = require('../Utils/constants');
const { generateChunk } = require('../World/terrainGen');
const { checkZoneTransfer, getZonePlayers } = require('../World/zoneManager');
const { placeBlock, removeBlock, getModifiedChunk, getTile } = require('../World/worldState');
const log = require('../Utils/logger');

const SOLID_TILES = [
  WORLD.TILES.DIRT, WORLD.TILES.STONE, WORLD.TILES.GRASS,
  WORLD.TILES.SAND, WORLD.TILES.WOOD, WORLD.TILES.LEAVES,
];

module.exports = function handleMessage(data, playerId, players, ws, wss, context) {
  const player = players[playerId];
  if (!player) {
    log(`⚠️ Message from unknown player: ${playerId}`);
    return;
  }

  const now = Date.now();
  if (now - player.lastMessageAt < SERVER.MIN_MESSAGE_INTERVAL) {
    return;
  }
  player.lastMessageAt = now;

  switch (data.type) {
    case MSG.MOVE:
      handleMove(data, player, playerId, ws, context);
      break;

    case MSG.CHAT:
      handleChat(data, player, playerId, context);
      break;

    case MSG.REQUEST_CHUNK:
      handleRequestChunk(data, player, playerId, ws);
      break;

    case MSG.INTERACT:
      handleInteract(data, player, playerId, ws, context);
      break;

    case MSG.PLACE_BLOCK:
      handlePlaceBlock(data, player, playerId, ws, context);
      break;

    case MSG.SET_PROFILE:
      handleSetProfile(data, player, playerId, ws, context);
      break;

    case MSG.REMOVE_BLOCK:
      handleRemoveBlock(data, player, playerId, ws, context);
      break;

    default:
      log(`⚠️ Unknown message type from ${playerId}: ${data.type}`);
      sendError(ws, `Unknown message type: ${data.type}`);
  }
};

// ─────────────────────────────────────────────
// MOVE Handler
// ─────────────────────────────────────────────
// Client sends: { type: 'move', x: number, y: number, jump: boolean }
//
// Server-side gravity model:
//   - Client sends desired X position and optional jump flag
//   - Server validates horizontal movement delta
//   - Server applies horizontal collision check
//   - Jump flag sets velocityY (physics loop handles the rest)
//   - Y position is IGNORED from client — server controls it
//   - Position broadcast happens in the physics loop, not here

function handleMove(data, player, playerId, ws, context) {
  const { x, y, jump } = data;

  if (typeof x !== 'number') {
    sendError(ws, 'Move requires numeric x');
    return;
  }

  if (!isFinite(x)) {
    sendError(ws, 'Move coordinates must be finite');
    return;
  }

  // Anti-cheat: check horizontal delta
  const dx = Math.abs(x - player.x);
  if (dx > PLAYER.MAX_MOVE_DELTA) {
    sendError(ws, 'Movement too large');
    return;
  }

  // Horizontal collision check
  const newTileX = Math.floor(x + (x > player.x ? 0.9 : 0));
  const playerTileY = Math.floor(player.y);
  const headY = playerTileY;
  const feetY = playerTileY + 0.9;

  const headTile = getTile(newTileX, Math.floor(headY));
  const feetTile = getTile(newTileX, Math.floor(feetY));

  if (SOLID_TILES.includes(headTile) || SOLID_TILES.includes(feetTile)) {
    // Blocked — don't update X
  } else {
    player.x = x;
  }

  // Handle jump request
  if (jump && player.onGround) {
    player.velocityY = -280; // JUMP_VELOCITY — matches frontend
    player.onGround = false;
  }

  // Also accept Y from client for backward compatibility,
  // but the physics loop will override it next tick.
  // This keeps AI agents and old clients from breaking.
  if (typeof y === 'number' && isFinite(y)) {
    const dy = Math.abs(y - player.y);
    if (dy <= PLAYER.MAX_MOVE_DELTA) {
      // Only accept if no server physics has run yet (first few ticks)
      // After that, the physics loop owns Y
    }
  }

  // Zone transfer check
  const oldZone = player.zone;
  const newZone = checkZoneTransfer(playerId, oldZone, player.x, player.y);

  if (newZone) {
    player.zone = newZone;

    context.broadcastToZone(oldZone, {
      type: MSG.PLAYER_LEFT,
      id: playerId,
    });

    context.broadcastToZone(newZone, {
      type: MSG.PLAYER_JOINED,
      id: playerId,
      x: player.x,
      y: player.y,
    }, playerId);

    ws.send(JSON.stringify({
      type: 'zoneChanged',
      zone: newZone,
    }));

    log(`🔀 ${playerId}: ${oldZone} → ${newZone}`);
  }

  // NOTE: Position broadcast is handled by the physics loop in main.js
  // We still broadcast X changes immediately for responsiveness
  context.broadcastToZone(player.zone, {
    type: MSG.PLAYER_MOVED,
    id: playerId,
    x: player.x,
    y: player.y,
  }, playerId);
}

// ─────────────────────────────────────────────
// CHAT Handler
// ─────────────────────────────────────────────

function handleChat(data, player, playerId, context) {
  let { message } = data;

  if (typeof message !== 'string' || message.trim().length === 0) {
    return;
  }

  message = message.trim().substring(0, 500);
  message = message.replace(/[\x00-\x1F\x7F]/g, '');

  if (message.length === 0) return;

  log(`💬 [${player.zone}] ${playerId}: ${message}`);

  context.broadcastToZone(player.zone, {
    type: MSG.CHAT_MESSAGE,
    id: playerId,
    message,
    timestamp: Date.now(),
  });
}

// ─────────────────────────────────────────────
// REQUEST CHUNK Handler
// ─────────────────────────────────────────────

function handleRequestChunk(data, player, playerId, ws) {
  const { chunkX, chunkY } = data;

  if (typeof chunkX !== 'number' || typeof chunkY !== 'number') {
    sendError(ws, 'requestChunk requires numeric chunkX and chunkY');
    return;
  }

  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY)) {
    sendError(ws, 'Chunk coordinates must be integers');
    return;
  }

  const { CHUNK_SIZE } = WORLD;
  const playerChunkX = Math.floor(player.x / CHUNK_SIZE);
  const playerChunkY = Math.floor(player.y / CHUNK_SIZE);

  const chunkDistance = Math.max(
    Math.abs(chunkX - playerChunkX),
    Math.abs(chunkY - playerChunkY)
  );

  if (chunkDistance > 5) {
    sendError(ws, 'Requested chunk is too far from your position');
    return;
  }

  const chunk = getModifiedChunk(chunkX, chunkY);

  ws.send(JSON.stringify({
    type: MSG.CHUNK_DATA,
    chunk,
  }));
}

// ─────────────────────────────────────────────
// PLACE BLOCK Handler
// ─────────────────────────────────────────────

function handlePlaceBlock(data, player, playerId, ws, context) {
  const { x, y, tile } = data;

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    sendError(ws, 'placeBlock requires integer x and y');
    return;
  }

  if (!Number.isInteger(tile) || tile < 0 || tile > 7) {
    sendError(ws, 'placeBlock requires valid tile type (0-7)');
    return;
  }

  const maxRange = player.isAI ? 50 : 10;
  const dx = Math.abs(x - Math.round(player.x));
  const dy = Math.abs(y - Math.round(player.y));

  if (dx > maxRange || dy > maxRange) {
    sendError(ws, 'Block placement too far from your position');
    return;
  }

  const success = placeBlock(x, y, tile);
  if (!success) {
    sendError(ws, 'Failed to place block');
    return;
  }

  const tileName = Object.keys(WORLD.TILES).find(k => WORLD.TILES[k] === tile) || 'UNKNOWN';
  log(`🧱 ${playerId} placed ${tileName} at (${x}, ${y})`);

  context.broadcastToZone(player.zone, {
    type: MSG.BLOCK_UPDATE,
    x,
    y,
    tile,
    placedBy: playerId,
  });
}

// ─────────────────────────────────────────────
// REMOVE BLOCK Handler
// ─────────────────────────────────────────────

function handleRemoveBlock(data, player, playerId, ws, context) {
  const { x, y } = data;

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    sendError(ws, 'removeBlock requires integer x and y');
    return;
  }

  const maxRange = player.isAI ? 50 : 10;
  const dx = Math.abs(x - Math.round(player.x));
  const dy = Math.abs(y - Math.round(player.y));

  if (dx > maxRange || dy > maxRange) {
    sendError(ws, 'Block removal too far from your position');
    return;
  }

  const currentTile = getTile(x, y);
  if (currentTile === WORLD.TILES.AIR) {
    sendError(ws, 'No block to remove at that position');
    return;
  }

  const success = removeBlock(x, y);
  if (!success) {
    sendError(ws, 'Failed to remove block');
    return;
  }

  const tileName = Object.keys(WORLD.TILES).find(k => WORLD.TILES[k] === currentTile) || 'UNKNOWN';
  log(`⛏️ ${playerId} removed ${tileName} at (${x}, ${y})`);

  context.broadcastToZone(player.zone, {
    type: MSG.BLOCK_UPDATE,
    x,
    y,
    tile: WORLD.TILES.AIR,
    placedBy: playerId,
  });
}

// ─────────────────────────────────────────────
// INTERACT Handler (Stub)
// ─────────────────────────────────────────────

function handleInteract(data, player, playerId, ws, context) {
  const { target, action } = data;

  if (!target || !action) {
    sendError(ws, 'interact requires target and action');
    return;
  }

  log(`🤝 ${playerId} interacted: ${action} on ${target}`);

  ws.send(JSON.stringify({
    type: 'interactResult',
    target,
    action,
    result: 'not_implemented',
    message: 'Interactions coming soon!',
  }));
}

// ─────────────────────────────────────────────
// SET PROFILE Handler
// ─────────────────────────────────────────────

function handleSetProfile(data, player, playerId, ws, context) {
  let { name, color } = data;

  if (typeof name === 'string' && name.trim().length > 0) {
    name = name.trim().substring(0, 16).replace(/[\x00-\x1F\x7F]/g, '');
    player.name = name;
  }

  if (typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color)) {
    player.color = color;
  }

  log(`🎨 ${playerId} set profile: name="${player.name}", color="${player.color}"`);

  context.broadcastToZone(player.zone, {
    type: 'profileUpdate',
    id: playerId,
    name: player.name,
    color: player.color,
  });
}

// ─────────────────────────────────────────────
// Error Response Helper
// ─────────────────────────────────────────────

function sendError(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: MSG.ERROR,
      message,
    }));
  }
}
