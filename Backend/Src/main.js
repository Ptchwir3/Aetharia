// Backend/Src/main.js
//
// AETHARIA — Main Backend Server
// ================================
// Core WebSocket server with SERVER-SIDE GRAVITY.
// A physics loop runs every 50ms, applying gravity to all
// players, checking terrain collision, and broadcasting
// authoritative positions. Clients send horizontal input
// and jump requests; the server owns Y position.

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const handleMessage = require('./Handlers/handleMessage');
const { createPlayer } = require('./Player/player');
const { assignPlayerToZone, removePlayerFromZone, getZonePlayers } = require('./World/zoneManager');
const { generateChunk } = require('./World/terrainGen');
const { getModifiedChunk, getTile } = require('./World/worldState');
const log = require('./Utils/logger');
const { WORLD, SERVER, MSG } = require('./Utils/constants');

// ─────────────────────────────────────────────
// Physics Constants
// ─────────────────────────────────────────────

const PHYSICS_TICK_RATE = 50; // ms between physics updates (20 ticks/sec)
const GRAVITY = 30;           // tiles/sec² (applied per tick as fraction)
const MAX_FALL_SPEED = 25;    // max tiles/sec downward
const JUMP_VELOCITY = -14;    // tiles/sec upward on jump

const SOLID_TILES = [
  WORLD.TILES.DIRT, WORLD.TILES.STONE, WORLD.TILES.GRASS,
  WORLD.TILES.SAND, WORLD.TILES.WOOD, WORLD.TILES.LEAVES,
];

function isSolid(tileX, tileY) {
  const tile = getTile(Math.floor(tileX), Math.floor(tileY));
  return SOLID_TILES.includes(tile);
}

// ─────────────────────────────────────────────
// Server Setup
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 8080;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const players = {};
const wsToPlayerId = new Map();
const playerIdToWs = new Map();

// ─────────────────────────────────────────────
// Find spawn surface
// ─────────────────────────────────────────────
// Scans vertically at spawnX to find a safe spawn position
// (in air, above solid ground).

function findSpawnSurface(spawnX) {
  // Start from high up and scan down to find the first air tile
  // above a solid tile
  for (let y = -20; y < 50; y++) {
    const tile = getTile(spawnX, y);
    const tileBelow = getTile(spawnX, y + 1);
    if (!SOLID_TILES.includes(tile) && SOLID_TILES.includes(tileBelow)) {
      return y;
    }
  }
  return 0; // Fallback
}

// ─────────────────────────────────────────────
// Connection Handler
// ─────────────────────────────────────────────

wss.on('connection', (ws) => {
  const playerId = uuidv4();

  const player = createPlayer(playerId);
  players[playerId] = player;

  wsToPlayerId.set(ws, playerId);
  playerIdToWs.set(playerId, ws);

  // Find safe spawn position on the surface
  const spawnY = findSpawnSurface(Math.round(player.x));
  player.y = spawnY;
  player.onGround = true;

  const zoneId = assignPlayerToZone(playerId, player.x, player.y);
  player.zone = zoneId;

  log(`🧍 Player connected: ${playerId} → ${zoneId} at (${player.x}, ${player.y})`);

  // Generate initial chunks
  const spawnChunkX = Math.floor(player.x / WORLD.CHUNK_SIZE);
  const spawnChunkY = Math.floor(player.y / WORLD.CHUNK_SIZE);

  const initialChunks = {};
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cx = spawnChunkX + dx;
      const cy = spawnChunkY + dy;
      initialChunks[`${cx},${cy}`] = getModifiedChunk(cx, cy);
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

  broadcastToZone(zoneId, {
    type: 'playerJoined',
    id: playerId,
    name: player.name,
    color: player.color,
    x: player.x,
    y: player.y,
  }, playerId);

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

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
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

  ws.on('close', () => {
    const player = players[playerId];
    const zoneId = player ? player.zone : null;

    log(`🚪 Player disconnected: ${playerId} (zone: ${zoneId})`);

    if (zoneId) {
      removePlayerFromZone(playerId, zoneId);
    }

    wsToPlayerId.delete(ws);
    playerIdToWs.delete(playerId);
    delete players[playerId];

    if (zoneId) {
      broadcastToZone(zoneId, {
        type: 'playerLeft',
        id: playerId,
        name: player.name,
        color: player.color,
      });
    }
  });

  ws.on('error', (err) => {
    log(`⚠️ WebSocket error for ${playerId}: ${err.message}`);
  });
});

// ─────────────────────────────────────────────
// Physics Loop
// ─────────────────────────────────────────────
// Runs every PHYSICS_TICK_RATE ms. For each connected player:
//   1. Apply gravity (increase velocityY)
//   2. Calculate new Y position
//   3. Check terrain collision (feet for falling, head for jumping)
//   4. If position changed, broadcast to zone
//
// This is the AUTHORITATIVE source of Y position for all entities.

function startPhysicsLoop() {
  const dt = PHYSICS_TICK_RATE / 1000; // Convert to seconds

  setInterval(() => {
    for (const playerId of Object.keys(players)) {
      const player = players[playerId];
      if (!player) continue;

      const prevY = player.y;

      // Apply gravity
      player.velocityY += GRAVITY * dt;
      if (player.velocityY > MAX_FALL_SPEED) {
        player.velocityY = MAX_FALL_SPEED;
      }

      const deltaY = player.velocityY * dt;
      let newY = player.y + deltaY;

      const tileX = player.x;
      const leftEdge = tileX + 0.1;
      const rightEdge = tileX + 0.9;

      if (player.velocityY > 0) {
        // Falling — check below feet
        const feetCheckY = newY + 1.0;
        if (isSolid(leftEdge, feetCheckY) || isSolid(rightEdge, feetCheckY)) {
          // Land on top of the solid tile
          const landY = Math.floor(feetCheckY) - 1;
          newY = landY;
          player.velocityY = 0;
          player.onGround = true;
        } else {
          player.onGround = false;
        }
      } else if (player.velocityY < 0) {
        // Jumping — check above head
        const headCheckY = newY;
        if (isSolid(leftEdge, headCheckY) || isSolid(rightEdge, headCheckY)) {
          // Bonk head on ceiling
          const bonkY = Math.floor(headCheckY) + 1;
          newY = bonkY;
          player.velocityY = 0;
        }
      }

      // Additional ground check: if not moving vertically,
      // verify we still have ground beneath us
      if (player.onGround && player.velocityY === 0) {
        const belowFeetY = newY + 1.0;
        if (!isSolid(leftEdge, belowFeetY) && !isSolid(rightEdge, belowFeetY)) {
          player.onGround = false;
          // Will start falling next tick
        }
      }

      // Unstick: if player is inside a solid tile, push up
      if (isSolid(tileX + 0.5, newY + 0.5)) {
        for (let checkY = newY; checkY > newY - 10; checkY--) {
          if (!isSolid(tileX + 0.5, checkY + 0.5)) {
            newY = checkY;
            player.velocityY = 0;
            player.onGround = false;
            break;
          }
        }
      }

      player.y = newY;

      // Broadcast if position changed meaningfully
      if (Math.abs(player.y - prevY) > 0.01) {
        const ws = playerIdToWs.get(playerId);

        // Send authoritative position to the player themselves
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'positionCorrection',
            x: player.x,
            y: player.y,
            onGround: player.onGround,
          }));
        }

        // Broadcast to other players in zone
        broadcastToZone(player.zone, {
          type: MSG.PLAYER_MOVED,
          id: playerId,
          x: player.x,
          y: player.y,
        }, playerId);
      }
    }
  }, PHYSICS_TICK_RATE);

  log(`⚡ Physics loop started (${PHYSICS_TICK_RATE}ms / ${1000/PHYSICS_TICK_RATE} ticks/sec)`);
}

// ─────────────────────────────────────────────
// Zone-Scoped Broadcasting
// ─────────────────────────────────────────────

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
  log(`   Physics: ${PHYSICS_TICK_RATE}ms tick, gravity=${GRAVITY}, jump=${JUMP_VELOCITY}`);
  log(`   Heartbeat interval: ${SERVER.HEARTBEAT_INTERVAL}ms`);
  startHeartbeat();
  startPhysicsLoop();
});
