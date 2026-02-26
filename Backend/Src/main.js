// Backend/Src/main.js
//
// AETHARIA — Main Backend Server
// ================================
// This is the core WebSocket server for Aetharia. It handles:
//   - Player connections and disconnections
//   - Player creation with full state (position, zone, inventory)
//   - Zone assignment on connect
//   - Terrain chunk delivery on connect
//   - Heartbeat/ping to detect dead connections
//   - Disconnect broadcasting so other players know someone left
//   - Message routing via handleMessage
//
// All player state flows through createPlayer() and zoneManager
// so every system has a consistent view of the world.

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// Game modules
const handleMessage = require('./Handlers/handleMessage');
const { createPlayer } = require('./Player/player');
const { assignPlayerToZone, removePlayerFromZone, getZonePlayers } = require('./World/zoneManager');
const { generateChunk } = require('./World/terrainGen');
const { getModifiedChunk } = require('./World/worldState');
const log = require('./Utils/logger');
const { WORLD, SERVER } = require('./Utils/constants');

// ─────────────────────────────────────────────
// Server Setup
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 8080;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ─────────────────────────────────────────────
// Player Registry
// ─────────────────────────────────────────────
// Master map of all connected players, keyed by player ID.
// Each value is a full player object from createPlayer().
// This is the single source of truth for player state.

const players = {};

// ─────────────────────────────────────────────
// WebSocket-to-Player Mapping
// ─────────────────────────────────────────────
// We need to look up a player's WebSocket connection when broadcasting,
// and look up a player ID from a WebSocket on disconnect.
// Two maps keep this O(1) in both directions.

const wsToPlayerId = new Map();  // WebSocket → playerId
const playerIdToWs = new Map();  // playerId → WebSocket

// ─────────────────────────────────────────────
// Connection Handler
// ─────────────────────────────────────────────

wss.on('connection', (ws) => {
  const playerId = uuidv4();

  // ── 1. Create full player object ──
  // createPlayer() returns { id, x, y, zone, inventory }
  // This ensures every player has a complete state from the start.
  const player = createPlayer(playerId);
  players[playerId] = player;

  // ── 2. Register WebSocket mappings ──
  wsToPlayerId.set(ws, playerId);
  playerIdToWs.set(playerId, ws);

  // ── 3. Assign player to a zone ──
  // The zone manager determines which zone this player belongs to
  // based on their spawn position. It also tracks them internally
  // so we can do zone-scoped broadcasts later.
  const zoneId = assignPlayerToZone(playerId, player.x, player.y);
  player.zone = zoneId;

  log(`🧍 Player connected: ${playerId} → ${zoneId}`);

  // ── 4. Send welcome packet ──
  // The welcome packet gives the client everything it needs to
  // initialize: their ID, spawn position, assigned zone, and
  // the terrain chunks for the zone they spawned in.
  const spawnChunkX = Math.floor(player.x / WORLD.CHUNK_SIZE);
  const spawnChunkY = Math.floor(player.y / WORLD.CHUNK_SIZE);

  // Generate the 3x3 grid of chunks around the player's spawn point.
  // This gives them immediate terrain to walk on without waiting
  // for additional chunk requests.
  const initialChunks = {};
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cx = spawnChunkX + dx;
      const cy = spawnChunkY + dy;
      const chunkKey = `${cx},${cy}`;
      initialChunks[chunkKey] = getModifiedChunk(cx, cy);
    }
  }

  ws.send(JSON.stringify({
    type: 'welcome',
    id: playerId,
    name: player.name,
    color: player.color,
    x: player.x,
    y: player.y,
    zone: zoneId,
    chunks: initialChunks,
    worldConfig: {
      chunkSize: WORLD.CHUNK_SIZE,
      tileSize: WORLD.TILE_SIZE,
    },
  }));

  // ── 5. Notify other players in the same zone ──
  // Everyone already in this zone needs to know a new player arrived.
  broadcastToZone(zoneId, {
    type: 'playerJoined',
    id: playerId,
    name: player.name,
    color: player.color,
    x: player.x,
    y: player.y,
  }, playerId); // exclude the new player themselves

  // ── 6. Send existing players to the new player ──
  // The new player needs to know about everyone already in their zone
  // so they can render them immediately.
  const zonePlayers = getZonePlayers(zoneId);
  const existingPlayers = zonePlayers
    .filter((pid) => pid !== playerId && players[pid])
    .map((pid) => ({
      id: pid,
      name: players[pid].name,
      color: players[pid].color,
      x: players[pid].x,
      y: players[pid].y,
    }));

  if (existingPlayers.length > 0) {
    ws.send(JSON.stringify({
      type: 'existingPlayers',
      players: existingPlayers,
    }));
  }

  // ── 7. Message handler ──
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      // Allow AI agents to self-identify
      if (data.type === 'identify' && data.isAI === true) {
        player.isAI = true;
        log(`🤖 Player ${playerId} identified as AI agent`);
        return;
      }
      handleMessage(data, playerId, players, ws, wss, {
        broadcastToZone,
        playerIdToWs,
        wsToPlayerId,
      });
    } catch (e) {
      log(`❌ Bad message from ${playerId}: ${msg}`);
    }
  });

  // ── 8. Disconnect handler ──
  ws.on('close', () => {
    const player = players[playerId];
    const zoneId = player ? player.zone : null;

    log(`🚪 Player disconnected: ${playerId} (zone: ${zoneId})`);

    // Remove from zone tracking
    if (zoneId) {
      removePlayerFromZone(playerId, zoneId);
    }

    // Clean up mappings
    wsToPlayerId.delete(ws);
    playerIdToWs.delete(playerId);
    delete players[playerId];

    // Broadcast disconnect to remaining players in the zone
    // so they can remove the sprite/entity from their world.
    if (zoneId) {
      broadcastToZone(zoneId, {
        type: 'playerLeft',
        id: playerId,
        name: player.name,
        color: player.color,
      });
    }
  });

  // ── 9. Error handler ──
  ws.on('error', (err) => {
    log(`⚠️ WebSocket error for ${playerId}: ${err.message}`);
  });
});

// ─────────────────────────────────────────────
// Zone-Scoped Broadcasting
// ─────────────────────────────────────────────
// Instead of blasting every message to every connected client,
// we only send to players in the same zone. This is essential
// for scaling — a player in zone_north doesn't need to know
// about movement in zone_south.
//
// excludePlayerId: optional player ID to skip (e.g., don't
// echo a player's own movement back to them).

function broadcastToZone(zoneId, message, excludePlayerId = null) {
  const zonePlayers = getZonePlayers(zoneId);
  const msgString = JSON.stringify(message);

  for (const pid of zonePlayers) {
    if (pid === excludePlayerId) continue;

    const targetWs = playerIdToWs.get(pid);
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(msgString);
    }
  }
}

// ─────────────────────────────────────────────
// Heartbeat System
// ─────────────────────────────────────────────
// WebSocket connections can silently die (e.g., laptop lid closed,
// network cable pulled). Without heartbeat, the server thinks
// they're still connected and keeps broadcasting to them.
//
// Every HEARTBEAT_INTERVAL ms, we ping all clients. If a client
// doesn't respond with a pong before the next heartbeat cycle,
// we terminate their connection, which triggers the 'close'
// handler above and cleans everything up.

function startHeartbeat() {
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        const playerId = wsToPlayerId.get(ws);
        log(`💀 Heartbeat timeout, terminating: ${playerId}`);
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, SERVER.HEARTBEAT_INTERVAL);
}

// Mark connections as alive when they respond to ping
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────

server.listen(PORT, () => {
  log(`🌍 AETHARIA server running on port ${PORT}`);
  log(`   Chunk size: ${WORLD.CHUNK_SIZE} tiles`);
  log(`   Tile size: ${WORLD.TILE_SIZE}px`);
  log(`   Heartbeat interval: ${SERVER.HEARTBEAT_INTERVAL}ms`);
  startHeartbeat();
});
