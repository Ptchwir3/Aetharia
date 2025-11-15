// backend/src/main.js

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// Game modules (to be created)
const handleMessage = require('./Handlers/handleMessage');
const log = require('./Utils/logger');

const PORT = process.env.PORT || 8080;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = {}; // In-memory player map

wss.on('connection', (ws) => {
  const playerId = uuidv4();
  players[playerId] = { id: playerId, x: 0, y: 0 };
  log(`🧍 Player connected: ${playerId}`);

  ws.send(JSON.stringify({ type: 'welcome', id: playerId }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      handleMessage(data, playerId, players, ws, wss);
    } catch (e) {
      log(`❌ Bad message from ${playerId}: ${msg}`);
    }
  });

  ws.on('close', () => {
    log(`🚪 Player disconnected: ${playerId}`);
    delete players[playerId];
    // Broadcast disconnect to others (optional)
  });
});

server.listen(PORT, () => {
  log(`🌍 AETHARIA server running on port ${PORT}`);
});
