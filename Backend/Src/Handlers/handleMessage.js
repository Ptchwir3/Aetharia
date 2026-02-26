// Backend/Src/Handlers/handleMessage.js
//
// AETHARIA — Message Handler
// ================================
// Routes incoming WebSocket messages to the appropriate handler.
// Every message from a client is JSON with a `type` field that
// determines how it's processed.
//
// Supported message types:
//   move          — Player position update
//   chat          — Chat message to zone
//   requestChunk  — Request terrain data for a chunk
//   interact      — Player interacts with world/object (stub)
//
// All handlers validate input before processing. Bad data is
// rejected with an error message back to the client.
//
// The `context` parameter provides access to server utilities
// like broadcastToZone and the WebSocket maps, keeping the
// handler decoupled from server internals.

const { PLAYER, MSG, SERVER, WORLD } = require('../Utils/constants');
const { generateChunk } = require('../World/terrainGen');
const { checkZoneTransfer, getZonePlayers } = require('../World/zoneManager');
const { placeBlock, removeBlock, getModifiedChunk, getTile } = require('../World/worldState');
const log = require('../Utils/logger');

/**
 * Handle an incoming message from a connected client.
 *
 * @param {object} data - Parsed JSON message from client
 * @param {string} playerId - ID of the sending player
 * @param {object} players - Master player registry (all connected players)
 * @param {WebSocket} ws - The sender's WebSocket connection
 * @param {WebSocket.Server} wss - The WebSocket server instance
 * @param {object} context - Server utilities
 * @param {Function} context.broadcastToZone - Zone-scoped broadcast function
 * @param {Map} context.playerIdToWs - Player ID → WebSocket map
 * @param {Map} context.wsToPlayerId - WebSocket → Player ID map
 */
module.exports = function handleMessage(data, playerId, players, ws, wss, context) {
  const player = players[playerId];
  if (!player) {
    log(`⚠️ Message from unknown player: ${playerId}`);
    return;
  }

  // ── Rate Limiting ──
  // Reject messages that arrive faster than MIN_MESSAGE_INTERVAL.
  // This prevents clients from flooding the server.
  const now = Date.now();
  if (now - player.lastMessageAt < SERVER.MIN_MESSAGE_INTERVAL) {
    // Silently drop — don't send an error for every dropped
    // message or we'd just be flooding in the other direction.
    return;
  }
  player.lastMessageAt = now;

  // ── Route by message type ──
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
// Client sends: { type: 'move', x: number, y: number }
//
// Validates:
//   - x and y are numbers
//   - Movement delta is within MAX_MOVE_DELTA (anti-cheat)
//
// On valid move:
//   - Updates player position in the registry
//   - Checks for zone transfer
//   - Broadcasts new position to same-zone players
//   - On zone transfer: broadcasts leave/join to old/new zones

function handleMove(data, player, playerId, ws, context) {
  const { x, y } = data;

  // ── Validate input ──
  if (typeof x !== 'number' || typeof y !== 'number') {
    sendError(ws, 'Move requires numeric x and y');
    return;
  }

  if (!isFinite(x) || !isFinite(y)) {
    sendError(ws, 'Move coordinates must be finite numbers');
    return;
  }

  // ── Anti-cheat: check movement delta ──
  const dx = Math.abs(x - player.x);
  const dy = Math.abs(y - player.y);

  if (dx > PLAYER.MAX_MOVE_DELTA || dy > PLAYER.MAX_MOVE_DELTA) {
    log(`🚫 Suspicious move from ${playerId}: delta (${dx}, ${dy}) exceeds max ${PLAYER.MAX_MOVE_DELTA}`);
    sendError(ws, 'Movement too large');
    return;
  }

  // ── Update position ──
  const oldZone = player.zone;
  player.x = x;
  player.y = y;

  // ── Check zone transfer ──
  const newZone = checkZoneTransfer(playerId, oldZone, x, y);

  if (newZone) {
    // Player crossed a zone boundary
    player.zone = newZone;

    // Tell old zone this player left
    context.broadcastToZone(oldZone, {
      type: MSG.PLAYER_LEFT,
      id: playerId,
    });

    // Tell new zone this player arrived
    context.broadcastToZone(newZone, {
      type: MSG.PLAYER_JOINED,
      id: playerId,
      x: player.x,
      y: player.y,
    }, playerId);

    // Tell the player about their new zone and its existing players
    const zonePlayers = getZonePlayers(newZone);
    const existingPlayers = zonePlayers
      .filter((pid) => pid !== playerId)
      .map((pid) => {
        // We need access to all players, but we only have
        // the current player. The context doesn't include
        // the full players map, so we'll handle this in the
        // caller. For now, send a zone change notification.
        return pid;
      });

    ws.send(JSON.stringify({
      type: 'zoneChanged',
      zone: newZone,
    }));

    log(`🔀 ${playerId}: ${oldZone} → ${newZone}`);
  }

  // ── Broadcast movement to same-zone players ──
  context.broadcastToZone(player.zone, {
    type: MSG.PLAYER_MOVED,
    id: playerId,
    x: player.x,
    y: player.y,
  }, playerId); // exclude sender
}

// ─────────────────────────────────────────────
// CHAT Handler
// ─────────────────────────────────────────────
// Client sends: { type: 'chat', message: string }
//
// Chat is zone-scoped: only players in the same zone see it.
// Messages are sanitized and length-limited.

function handleChat(data, player, playerId, context) {
  let { message } = data;

  // ── Validate ──
  if (typeof message !== 'string' || message.trim().length === 0) {
    return; // Silently drop empty messages
  }

  // ── Sanitize ──
  // Trim whitespace, limit length, strip control characters
  message = message.trim().substring(0, 500);
  message = message.replace(/[\x00-\x1F\x7F]/g, ''); // Remove control chars

  if (message.length === 0) return;

  log(`💬 [${player.zone}] ${playerId}: ${message}`);

  // ── Broadcast to zone ──
  context.broadcastToZone(player.zone, {
    type: MSG.CHAT_MESSAGE,
    id: playerId,
    message,
    timestamp: Date.now(),
  });
  // Note: we don't exclude the sender here — they should see
  // their own message confirmed by the server.
}

// ─────────────────────────────────────────────
// REQUEST CHUNK Handler
// ─────────────────────────────────────────────
// Client sends: { type: 'requestChunk', chunkX: number, chunkY: number }
//
// The client requests terrain data for a specific chunk.
// This is used when the player moves into unloaded territory.
// The server generates the chunk (deterministically) and sends it back.

function handleRequestChunk(data, player, playerId, ws) {
  const { chunkX, chunkY } = data;

  // ── Validate ──
  if (typeof chunkX !== 'number' || typeof chunkY !== 'number') {
    sendError(ws, 'requestChunk requires numeric chunkX and chunkY');
    return;
  }

  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY)) {
    sendError(ws, 'Chunk coordinates must be integers');
    return;
  }

  // ── Optional: limit how far from the player a chunk can be requested ──
  // Prevents clients from scanning the entire world map.
  // Allow chunks within 5 chunks of the player's position.
  // (This is generous — the client only needs 3x3 around them.)
  const { CHUNK_SIZE } = require('../Utils/constants').WORLD;
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

  // ── Generate and send (with modifications applied) ──
  const chunk = getModifiedChunk(chunkX, chunkY);

  ws.send(JSON.stringify({
    type: MSG.CHUNK_DATA,
    chunk,
  }));
}

// ─────────────────────────────────────────────
// PLACE BLOCK Handler
// ─────────────────────────────────────────────
// Client sends: { type: 'placeBlock', x: number, y: number, tile: number }
//
// Places a block at the specified world tile position.
// Validates position and tile type, updates world state,
// and broadcasts the change to all players in the zone.

function handlePlaceBlock(data, player, playerId, ws, context) {
  const { x, y, tile } = data;

  // ── Validate input ──
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    sendError(ws, 'placeBlock requires integer x and y');
    return;
  }

  if (!Number.isInteger(tile) || tile < 0 || tile > 7) {
    sendError(ws, 'placeBlock requires valid tile type (0-7)');
    return;
  }

  // ── Range check ──
  // Players can only place blocks within a reasonable distance.
  // AI agents get a larger range since they're building structures.
  const maxRange = player.isAI ? 50 : 10;
  const dx = Math.abs(x - Math.round(player.x));
  const dy = Math.abs(y - Math.round(player.y));

  if (dx > maxRange || dy > maxRange) {
    sendError(ws, 'Block placement too far from your position');
    return;
  }

  // ── Place the block ──
  const success = placeBlock(x, y, tile);
  if (!success) {
    sendError(ws, 'Failed to place block');
    return;
  }

  const tileName = Object.keys(WORLD.TILES).find(k => WORLD.TILES[k] === tile) || 'UNKNOWN';
  log(`🧱 ${playerId} placed ${tileName} at (${x}, ${y})`);

  // ── Broadcast to all players in the zone ──
  // Everyone needs to see the world change in real time.
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
// Client sends: { type: 'removeBlock', x: number, y: number }
//
// Removes (mines) a block at the specified position,
// replacing it with AIR. Broadcasts the change to zone.

function handleRemoveBlock(data, player, playerId, ws, context) {
  const { x, y } = data;

  // ── Validate input ──
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    sendError(ws, 'removeBlock requires integer x and y');
    return;
  }

  // ── Range check ──
  const maxRange = player.isAI ? 50 : 10;
  const dx = Math.abs(x - Math.round(player.x));
  const dy = Math.abs(y - Math.round(player.y));

  if (dx > maxRange || dy > maxRange) {
    sendError(ws, 'Block removal too far from your position');
    return;
  }

  // ── Check there's actually a block there ──
  const currentTile = getTile(x, y);
  if (currentTile === WORLD.TILES.AIR) {
    sendError(ws, 'No block to remove at that position');
    return;
  }

  // ── Remove the block ──
  const success = removeBlock(x, y);
  if (!success) {
    sendError(ws, 'Failed to remove block');
    return;
  }

  const tileName = Object.keys(WORLD.TILES).find(k => WORLD.TILES[k] === currentTile) || 'UNKNOWN';
  log(`⛏️ ${playerId} removed ${tileName} at (${x}, ${y})`);

  // ── Broadcast to all players in the zone ──
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
// Client sends: { type: 'interact', target: string, action: string }
//
// Placeholder for future interactions: mining blocks, picking
// up items, talking to NPCs, opening doors, etc.

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

// ─────────────────────────────────────────────
// SET PROFILE Handler
// ─────────────────────────────────────────────
// Client sends: { type: 'setProfile', name: string, color: string }
//
// Sets the player's display name and color.
// Broadcasts the update to all players in the zone.

function handleSetProfile(data, player, playerId, ws, context) {
  let { name, color } = data;

  // Validate name
  if (typeof name === 'string' && name.trim().length > 0) {
    name = name.trim().substring(0, 16).replace(/[\x00-\x1F\x7F]/g, '');
    player.name = name;
  }

  // Validate color (hex format)
  if (typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color)) {
    player.color = color;
  }

  log(`🎨 ${playerId} set profile: name="${player.name}", color="${player.color}"`);

  // Broadcast to zone so everyone sees the update
  context.broadcastToZone(player.zone, {
    type: 'profileUpdate',
    id: playerId,
    name: player.name,
    color: player.color,
  });
}
