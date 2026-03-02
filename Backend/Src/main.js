// Backend/Src/main.js
//
// AETHARIA — Main Backend Server
// ================================
// Core WebSocket server with:
//   - Authentication (register/login with persistent accounts)
//   - Server-side gravity
//   - Auto-save player state every 60 seconds

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const handleMessage = require('./Handlers/handleMessage');
const { handleRegister, handleLogin } = require('./Handlers/handleAuth');
const { createPlayer } = require('./Player/player');
const { assignPlayerToZone, removePlayerFromZone, getZonePlayers } = require('./World/zoneManager');
const { generateChunk } = require('./World/terrainGen');
const { getModifiedChunk, getTile } = require('./World/worldState');
const db = require('./Database/db');
const log = require('./Utils/logger');
const { WORLD, SERVER, MSG } = require('./Utils/constants');

// ─────────────────────────────────────────────
// Physics Constants
// ─────────────────────────────────────────────

const PHYSICS_TICK_RATE = 50;
const GRAVITY = 30;
const MAX_FALL_SPEED = 25;
const JUMP_VELOCITY = -14;

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

function findSpawnSurface(spawnX) {
  for (let y = -20; y < 50; y++) {
    const tile = getTile(spawnX, y);
    const tileBelow = getTile(spawnX, y + 1);
    if (!SOLID_TILES.includes(tile) && SOLID_TILES.includes(tileBelow)) {
      return y;
    }
  }
  return 0;
}

// ─────────────────────────────────────────────
// Helper: Send Welcome Packet
// ─────────────────────────────────────────────

function sendWelcome(ws, player, playerId) {
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
    zone: player.zone,
    credits: player.credits,
    inventory: player.inventory,
    chunks: initialChunks,
    worldConfig: {
      chunkSize: WORLD.CHUNK_SIZE,
      tileSize: WORLD.TILE_SIZE,
    },
  }));
}

function broadcastJoin(playerId, player) {
  broadcastToZone(player.zone, {
    type: 'playerJoined',
    id: playerId,
    name: player.name,
    color: player.color,
    x: player.x,
    y: player.y,
  }, playerId);
}

function sendExistingPlayers(ws, playerId, zoneId) {
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
}

// ─────────────────────────────────────────────
// Auto-Save Loop
// ─────────────────────────────────────────────

function startAutoSave() {
  setInterval(() => {
    let saved = 0;
    for (const playerId of Object.keys(players)) {
      const player = players[playerId];
      if (!player || !player.authenticated || !player.username) continue;
      try {
        db.savePlayerState(
          player.username, player.x, player.y,
          player.zone, player.inventory, player.credits
        );
        saved++;
      } catch (e) {
        log(`❌ Auto-save failed for ${player.username}: ${e.message}`);
      }
    }
    if (saved > 0) log(`💾 Auto-saved ${saved} player(s)`);
  }, 60000);

  log(`💾 Auto-save started (60s interval)`);
}

// ─────────────────────────────────────────────
// Connection Handler
// ─────────────────────────────────────────────

wss.on('connection', (ws) => {
  const playerId = uuidv4();
  let player = null;
  let authenticated = false;

  // Send auth prompt — client must register or login before playing
  ws.send(JSON.stringify({ type: 'authRequired' }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);

      // ── Pre-auth: handle register/login/identify ──
      if (!authenticated) {

        // AI agents bypass auth
        if (data.type === 'identify' && data.isAI === true) {
          player = createPlayer(playerId, {
            name: data.name || playerId.substring(0, 6),
            isAI: true,
            authenticated: true,
          });
          players[playerId] = player;
          wsToPlayerId.set(ws, playerId);
          playerIdToWs.set(playerId, ws);

          const spawnY = findSpawnSurface(Math.round(player.x));
          player.y = spawnY;
          player.onGround = true;

          const zoneId = assignPlayerToZone(playerId, player.x, player.y);
          player.zone = zoneId;
          authenticated = true;

          log(`🤖 AI agent connected: ${data.name || playerId} → ${zoneId}`);

          sendWelcome(ws, player, playerId);
          broadcastJoin(playerId, player);
          sendExistingPlayers(ws, playerId, zoneId);
          return;
        }

        // Register new account
        if (data.type === 'register') {
          const result = handleRegister(data, ws);
          if (!result) return; // Error already sent to client

          const spawnY = findSpawnSurface(Math.round(result.x));
          player = createPlayer(playerId, {
            username: result.username,
            x: result.x,
            y: spawnY,
            color: result.color,
            inventory: result.inventory,
            credits: result.credits,
            authenticated: true,
          });
          player.name = result.username;
          player.onGround = true;

          players[playerId] = player;
          wsToPlayerId.set(ws, playerId);
          playerIdToWs.set(playerId, ws);

          const zoneId = assignPlayerToZone(playerId, player.x, player.y);
          player.zone = zoneId;
          authenticated = true;

          sendWelcome(ws, player, playerId);
          broadcastJoin(playerId, player);
          sendExistingPlayers(ws, playerId, zoneId);
          return;
        }

        // Login to existing account
        if (data.type === 'login') {
          const result = handleLogin(data, ws);
          if (!result) return; // Error already sent to client

          // Use saved Y if reasonable, otherwise find surface
          const spawnY = findSpawnSurface(Math.round(result.x));
          const useY = (Math.abs(result.y) < 200) ? result.y : spawnY;

          player = createPlayer(playerId, {
            username: result.username,
            x: result.x,
            y: useY,
            zone: result.zone,
            color: result.color,
            inventory: result.inventory,
            credits: result.credits,
            authenticated: true,
          });
          player.name = result.username;
          player.onGround = false; // Let physics settle

          players[playerId] = player;
          wsToPlayerId.set(ws, playerId);
          playerIdToWs.set(playerId, ws);

          const zoneId = assignPlayerToZone(playerId, player.x, player.y);
          player.zone = zoneId;
          authenticated = true;

          sendWelcome(ws, player, playerId);
          broadcastJoin(playerId, player);
          sendExistingPlayers(ws, playerId, zoneId);
          return;
        }

        // Unknown pre-auth message
        ws.send(JSON.stringify({ type: 'authError', message: 'Please log in or register first' }));
        return;
      }

      // ── Post-auth: normal game messages ──
      handleMessage(data, playerId, players, ws, wss, {
        broadcastToZone,
        playerIdToWs,
        wsToPlayerId,
      });
    } catch (e) {
      log(`❌ Bad message from ${playerId}: ${e.message}`);
    }
  });

  ws.on('close', () => {
    if (player) {
      const zoneId = player.zone;

      // Save to database on disconnect
      if (player.authenticated && player.username) {
        try {
          db.savePlayerState(
            player.username, player.x, player.y,
            player.zone, player.inventory, player.credits
          );
          log(`💾 Saved state for ${player.username}`);
        } catch (e) {
          log(`❌ Save failed for ${player.username}: ${e.message}`);
        }
      }

      log(`🚪 Player disconnected: ${player.name} (${playerId})`);

      if (zoneId) {
        removePlayerFromZone(playerId, zoneId);
        broadcastToZone(zoneId, {
          type: 'playerLeft',
          id: playerId,
          name: player.name,
          color: player.color,
        });
      }
    }

    wsToPlayerId.delete(ws);
    playerIdToWs.delete(playerId);
    delete players[playerId];
  });

  ws.on('error', (err) => {
    log(`⚠️ WebSocket error for ${playerId}: ${err.message}`);
  });
});

// ─────────────────────────────────────────────
// Physics Loop
// ─────────────────────────────────────────────

function startPhysicsLoop() {
  const dt = PHYSICS_TICK_RATE / 1000;

  setInterval(() => {
    for (const playerId of Object.keys(players)) {
      const player = players[playerId];
      if (!player) continue;

      const prevY = player.y;

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
        const feetCheckY = newY + 1.0;
        if (isSolid(leftEdge, feetCheckY) || isSolid(rightEdge, feetCheckY)) {
          const landY = Math.floor(feetCheckY) - 1;
          newY = landY;
          player.velocityY = 0;
          player.onGround = true;
        } else {
          player.onGround = false;
        }
      } else if (player.velocityY < 0) {
        const headCheckY = newY;
        if (isSolid(leftEdge, headCheckY) || isSolid(rightEdge, headCheckY)) {
          const bonkY = Math.floor(headCheckY) + 1;
          newY = bonkY;
          player.velocityY = 0;
        }
      }

      if (player.onGround && player.velocityY === 0) {
        const belowFeetY = newY + 1.0;
        if (!isSolid(leftEdge, belowFeetY) && !isSolid(rightEdge, belowFeetY)) {
          player.onGround = false;
        }
      }

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

      if (Math.abs(player.y - prevY) > 0.01) {
        const ws = playerIdToWs.get(playerId);

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'positionCorrection',
            x: player.x,
            y: player.y,
            onGround: player.onGround,
          }));
        }

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
  log(`   Database: ${process.env.DATABASE_PATH || 'data/aetharia.db'}`);
  log(`   Heartbeat interval: ${SERVER.HEARTBEAT_INTERVAL}ms`);
  startHeartbeat();
  startPhysicsLoop();
  startAutoSave();
});
