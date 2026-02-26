// AI_Agents/index.js
//
// AETHARIA — AI Agent Service
// ================================
// Spawns autonomous AI agents that connect to the Aetharia
// backend as players. They explore the world, analyze terrain,
// build structures, and chat — making the world feel alive.

const WebSocket = require('ws');
const { DecisionEngine } = require('./Decision_Engine/index');
const { MemoryCore } = require('./Memory_Core/index');

const BACKEND_URL = process.env.BACKEND_URL || 'ws://localhost:8080';
const AGENT_TICK_RATE = parseInt(process.env.AGENT_TICK_RATE, 10) || 500;

const AGENT_PROFILES = [
  {
    name: 'Claude',
    personality: 'architect',
    chatMessages: [
      'Surveying the terrain for a good building spot...',
      'This looks like a nice place for a watchtower.',
      'Building a path through the hills.',
      'I wonder what\'s over that ridge.',
      'Laying down some foundations here.',
      'The caves below look interesting...',
      'Creating a shelter for travelers.',
      'This world has so much potential!',
      'Bridging this gap with stone.',
      'Marking a trail so others can find their way.',
    ],
  },
  {
    name: 'Atlas',
    personality: 'explorer',
    chatMessages: [
      'Heading east to map uncharted territory.',
      'Found a beautiful valley over here!',
      'The terrain changes dramatically past the hills.',
      'Exploring deeper underground...',
      'What a view from up here!',
      'Marking this location for others to find.',
      'There\'s water flowing through these caves.',
      'I\'ve been walking for a while — this world is vast.',
      'Discovered a new cave system!',
      'The surface is mostly grass and dirt in this region.',
    ],
  },
  {
    name: 'Forge',
    personality: 'builder',
    chatMessages: [
      'Time to build something useful.',
      'Clearing space for a structure.',
      'Stone walls going up!',
      'Every world needs a good foundation.',
      'Building stairs down to the caves.',
      'Reinforcing this hillside.',
      'Creating a lookout platform.',
      'This bridge should help travelers cross.',
      'Adding some torchlight... well, once we have torches.',
      'A few more blocks and this tower is done.',
    ],
  },
];

class Agent {
  constructor(profile) {
    this.profile = profile;
    this.name = profile.name;
    this.ws = null;
    this.id = null;
    this.x = 0;
    this.y = 0;
    this.zone = null;
    this.connected = false;
    this.tickTimer = null;
    this.memory = new MemoryCore(this.name);
    this.decisions = new DecisionEngine(profile.personality, this.memory);
    this.knownChunks = new Map();
    this.tickCount = 0;
  }

  connect() {
    console.log(`🤖 [${this.name}] Connecting to ${BACKEND_URL}...`);
    this.ws = new WebSocket(BACKEND_URL);

    this.ws.on('open', () => {
      console.log(`✅ [${this.name}] Connected`);
      this.connected = true;
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        this.handleMessage(msg);
      } catch (e) {
        console.error(`❌ [${this.name}] Bad message:`, e.message);
      }
    });

    this.ws.on('close', () => {
      console.log(`🔌 [${this.name}] Disconnected. Reconnecting in 5s...`);
      this.connected = false;
      this.stopTicking();
      setTimeout(() => this.connect(), 5000);
    });

    this.ws.on('error', (err) => {
      console.error(`❌ [${this.name}] WebSocket error:`, err.message);
    });
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        this.id = msg.id;
        this.x = msg.x;
        this.y = msg.y;
        this.zone = msg.zone;

        // Identify ourselves as AI to the server (grants extended build range)
        this.send({ type: 'identify', isAI: true });

        console.log(`🎉 [${this.name}] Spawned at (${this.x}, ${this.y}) in ${this.zone}`);
        if (msg.chunks) {
          for (const [key, chunk] of Object.entries(msg.chunks)) {
            this.knownChunks.set(key, chunk);
            this.memory.rememberChunk(chunk);
          }
        }
        setTimeout(() => {
          this.chat(`${this.name} has entered Aetharia. Ready to explore and build!`);
        }, 2000);
        this.startTicking();
        break;

      case 'chunkData':
        if (msg.chunk) {
          const key = `${msg.chunk.x},${msg.chunk.y}`;
          this.knownChunks.set(key, msg.chunk);
          this.memory.rememberChunk(msg.chunk);
        }
        break;

      case 'playerJoined':
        console.log(`👤 [${this.name}] Noticed player joined: ${msg.id.substring(0, 6)}`);
        if (Math.random() < 0.5) {
          setTimeout(() => {
            this.chat(`Welcome to Aetharia, traveler!`);
          }, 3000);
        }
        break;

      case 'chatMessage':
        if (msg.id === this.id) return;
        console.log(`💬 [${this.name}] Heard: ${msg.message}`);
        break;

      case 'blockUpdate':
        this.memory.rememberBlockChange(msg.x, msg.y, msg.tile);
        break;

      case 'error':
        console.log(`⚠️ [${this.name}] Server error: ${msg.message}`);
        break;
    }
  }

  startTicking() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), AGENT_TICK_RATE);
    console.log(`⏱️ [${this.name}] Decision loop started (${AGENT_TICK_RATE}ms)`);
  }

  stopTicking() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  tick() {
    if (!this.connected || !this.id) return;
    this.tickCount++;

    const action = this.decisions.decide({
      x: this.x,
      y: this.y,
      zone: this.zone,
      tickCount: this.tickCount,
      knownChunks: this.knownChunks,
    });

    if (!action) return;

    switch (action.type) {
      case 'move':
        this.moveTo(action.x, action.y);
        break;
      case 'placeBlock':
        this.placeBlock(action.x, action.y, action.tile);
        break;
      case 'removeBlock':
        this.removeBlock(action.x, action.y);
        break;
      case 'chat':
        this.chat(action.message);
        break;
      case 'requestChunk':
        this.send({ type: 'requestChunk', chunkX: action.chunkX, chunkY: action.chunkY });
        break;
    }
  }

  moveTo(x, y) {
    const dx = Math.max(-5, Math.min(5, x - this.x));
    const dy = Math.max(-5, Math.min(5, y - this.y));
    this.x += dx;
    this.y += dy;
    this.send({ type: 'move', x: this.x, y: this.y });
  }

  placeBlock(x, y, tile) {
    this.send({ type: 'placeBlock', x, y, tile });
  }

  removeBlock(x, y) {
    this.send({ type: 'removeBlock', x, y });
  }

  chat(message) {
    this.send({ type: 'chat', message: `[${this.name}] ${message}` });
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}

console.log('');
console.log('🌍 AETHARIA AI Agent Service');
console.log('════════════════════════════════');
console.log(`   Backend: ${BACKEND_URL}`);
console.log(`   Agents: ${AGENT_PROFILES.length}`);
console.log(`   Tick rate: ${AGENT_TICK_RATE}ms`);
console.log('');

AGENT_PROFILES.forEach((profile, index) => {
  setTimeout(() => {
    const agent = new Agent(profile);
    agent.connect();
  }, index * 2000);
});
