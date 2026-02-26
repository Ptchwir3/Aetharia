// Frontend/Public/Src/main.js
//
// AETHARIA — Game Client
// ================================
// Phaser 3 game client for the Aetharia metaverse.
// Connects to the backend via WebSocket and renders:
//   - Procedural terrain from server-sent chunks
//   - Local player with keyboard movement
//   - Other players in the same zone (with names and colors)
//   - Chat overlay
//   - Profile picker (name + color) on connect

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const WS_HOST = params.get('server') || window.location.host || 'localhost:8080';
const WS_URL = `ws://${WS_HOST}`;

const SEND_RATE = 50;
const TILE_SIZE = 32;
const CHUNK_SIZE = 32;
const PLAYER_SPEED = 200;
const GRAVITY = 600;
const JUMP_VELOCITY = -280;
const MAX_FALL_SPEED = 500;
const SOLID_TILES = [1, 2, 3, 5, 6, 7]; // Everything except AIR(0) and WATER(4)

const TILE_COLORS = {
  0: null,         // AIR
  1: 0x8B6914,     // DIRT
  2: 0x808080,     // STONE
  3: 0x4CAF50,     // GRASS
  4: 0x2196F3,     // WATER
  5: 0xFFEB3B,     // SAND
  6: 0x5D4037,     // WOOD
  7: 0x2E7D32,     // LEAVES
};

const SKY_COLOR = '#87CEEB';

// Player color presets
const COLOR_PRESETS = [
  { name: 'Red',     hex: '#FF5722' },
  { name: 'Blue',    hex: '#2196F3' },
  { name: 'Green',   hex: '#4CAF50' },
  { name: 'Purple',  hex: '#9C27B0' },
  { name: 'Yellow',  hex: '#FFEB3B' },
  { name: 'Pink',    hex: '#E91E63' },
  { name: 'Cyan',    hex: '#00BCD4' },
  { name: 'Orange',  hex: '#FF9800' },
  { name: 'Lime',    hex: '#CDDC39' },
  { name: 'White',   hex: '#FFFFFF' },
];

// ─────────────────────────────────────────────
// Network Manager
// ─────────────────────────────────────────────

class NetworkManager {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.handlers = {};
    this.lastSendTime = 0;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('🔌 Connected to server');
      this.connected = true;
      this.reconnectDelay = 1000;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const handler = this.handlers[msg.type];
        if (handler) handler(msg);
      } catch (e) {
        console.error('Bad message:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('🔌 Disconnected');
      this.connected = false;
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  on(type, handler) {
    this.handlers[type] = handler;
  }

  send(data, force = false) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (!force && now - this.lastSendTime < SEND_RATE) return;
    this.lastSendTime = now;
    this.ws.send(JSON.stringify(data));
  }
}

// ─────────────────────────────────────────────
// Chunk Renderer
// ─────────────────────────────────────────────

class ChunkRenderer {
  constructor(scene) {
    this.scene = scene;
    this.chunks = {};
  }

  addChunks(chunksObj) {
    for (const [key, chunk] of Object.entries(chunksObj)) {
      this.addChunk(chunk);
    }
  }

  addChunk(chunk) {
    const key = `${chunk.x},${chunk.y}`;
    if (this.chunks[key]) return;

    const graphics = this.scene.add.graphics();
    graphics.setDepth(0);
    const startX = chunk.x * CHUNK_SIZE * TILE_SIZE;
    const startY = chunk.y * CHUNK_SIZE * TILE_SIZE;

    for (let ly = 0; ly < chunk.tiles.length; ly++) {
      for (let lx = 0; lx < chunk.tiles[ly].length; lx++) {
        const tile = chunk.tiles[ly][lx];
        const color = TILE_COLORS[tile];
        if (color === null || color === undefined) continue;

        graphics.fillStyle(color, 1);
        graphics.fillRect(
          startX + lx * TILE_SIZE,
          startY + ly * TILE_SIZE,
          TILE_SIZE,
          TILE_SIZE
        );
      }
    }

    this.chunks[key] = { graphics, data: chunk };
  }

  getMissingChunks(pixelX, pixelY) {
    const chunkX = Math.floor(pixelX / (CHUNK_SIZE * TILE_SIZE));
    const chunkY = Math.floor(pixelY / (CHUNK_SIZE * TILE_SIZE));
    const missing = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${chunkX + dx},${chunkY + dy}`;
        if (!this.chunks[key]) {
          missing.push({ chunkX: chunkX + dx, chunkY: chunkY + dy });
          this.chunks[key] = 'loading';
        }
      }
    }
    return missing;
  }

  updateBlock(worldX, worldY, tile) {
    const chunkX = Math.floor(worldX / CHUNK_SIZE);
    const chunkY = Math.floor(worldY / CHUNK_SIZE);
    const key = `${chunkX},${chunkY}`;
    const chunkEntry = this.chunks[key];
    if (!chunkEntry || !chunkEntry.graphics) return;

    const localX = ((worldX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY = ((worldY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const px = chunkX * CHUNK_SIZE * TILE_SIZE + localX * TILE_SIZE;
    const py = chunkY * CHUNK_SIZE * TILE_SIZE + localY * TILE_SIZE;

    const color = TILE_COLORS[tile];
    if (color === null || color === undefined) {
      // AIR — draw sky color over it
      chunkEntry.graphics.fillStyle(0x87CEEB, 1);
    } else {
      chunkEntry.graphics.fillStyle(color, 1);
    }
    chunkEntry.graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  }

  // Get tile type at a world tile position (for collision detection)
  getTileAt(worldTileX, worldTileY) {
    const chunkX = Math.floor(worldTileX / CHUNK_SIZE);
    const chunkY = Math.floor(worldTileY / CHUNK_SIZE);
    const key = `${chunkX},${chunkY}`;
    const chunkEntry = this.chunks[key];
    if (!chunkEntry || !chunkEntry.data || !chunkEntry.data.tiles) return 0; // Unknown = air
    const localX = ((worldTileX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY = ((worldTileY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunkEntry.data.tiles[localY][localX];
  }
}

// ─────────────────────────────────────────────
// Player Manager
// ─────────────────────────────────────────────

class PlayerManager {
  constructor(scene) {
    this.scene = scene;
    this.players = {};
  }

  addPlayer(id, x, y, name, color) {
    if (this.players[id]) return;

    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;

    const displayName = name || id.substring(0, 6);
    const displayColor = color ? parseInt(color.replace('#', '0x'), 16) : 0x00BCD4;

    const sprite = this.scene.add.rectangle(
      px + TILE_SIZE / 2,
      py + TILE_SIZE / 2,
      TILE_SIZE - 4,
      TILE_SIZE - 4,
      displayColor
    );
    sprite.setDepth(10);

    const label = this.scene.add.text(px, py - 18, displayName, {
      fontSize: '11px',
      fontFamily: 'monospace',
      color: '#ffffff',
      backgroundColor: '#00000088',
      padding: { x: 3, y: 2 },
    });
    label.setOrigin(0.5, 1);
    label.setPosition(px + TILE_SIZE / 2, py - 2);
    label.setDepth(11);

    this.players[id] = { sprite, label, name: displayName, color: displayColor };
  }

  updatePlayer(id, x, y) {
    const p = this.players[id];
    if (!p) return;
    const px = x * TILE_SIZE + TILE_SIZE / 2;
    const py = y * TILE_SIZE + TILE_SIZE / 2;
    p.sprite.setPosition(px, py);
    p.label.setPosition(px, py - TILE_SIZE / 2 - 2);
  }

  updateProfile(id, name, color) {
    const p = this.players[id];
    if (!p) return;
    if (name) {
      p.name = name;
      p.label.setText(name);
    }
    if (color) {
      const c = parseInt(color.replace('#', '0x'), 16);
      p.color = c;
      p.sprite.setFillStyle(c);
    }
  }

  removePlayer(id) {
    const p = this.players[id];
    if (!p) return;
    p.sprite.destroy();
    p.label.destroy();
    delete this.players[id];
  }

  clear() {
    for (const id of Object.keys(this.players)) {
      this.removePlayer(id);
    }
  }
}

// ─────────────────────────────────────────────
// Chat Manager
// ─────────────────────────────────────────────

class ChatManager {
  constructor() {
    this.onSend = null;
    this.visible = false;
    this.createDOM();
  }

  createDOM() {
    this.container = document.createElement('div');
    this.container.id = 'chat-container';
    this.container.style.cssText = `
      position: fixed; bottom: 10px; left: 10px;
      width: 400px; z-index: 1000;
      font-family: monospace; font-size: 13px;
      pointer-events: none;
    `;

    this.log = document.createElement('div');
    this.log.id = 'chat-log';
    this.log.style.cssText = `
      max-height: 200px; overflow-y: auto;
      background: rgba(0,0,0,0.5); color: #fff;
      padding: 6px; border-radius: 4px;
      display: none; margin-bottom: 4px;
      pointer-events: auto;
    `;
    this.container.appendChild(this.log);

    this.input = document.createElement('input');
    this.input.id = 'chat-input';
    this.input.type = 'text';
    this.input.placeholder = 'Press T to chat...';
    this.input.maxLength = 500;
    this.input.style.cssText = `
      width: 100%; box-sizing: border-box;
      background: rgba(0,0,0,0.7); color: #fff;
      border: 1px solid #555; padding: 6px;
      font-family: monospace; font-size: 13px;
      border-radius: 4px; display: none;
      outline: none; pointer-events: auto;
    `;

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const message = this.input.value.trim();
        if (message && this.onSend) {
          this.onSend(message);
        }
        this.hideInput();
      } else if (e.key === 'Escape') {
        this.hideInput();
      }
    });

    this.container.appendChild(this.input);
    document.body.appendChild(this.container);
  }

  addMessage(senderId, message, isSystem = false) {
    const div = document.createElement('div');
    div.style.cssText = 'margin-bottom: 2px; word-wrap: break-word;';

    if (isSystem) {
      div.innerHTML = `<span style="color: #aaa">⚙ ${this.escapeHtml(message)}</span>`;
    } else {
      const shortId = senderId ? senderId.substring(0, 6) : '???';
      div.innerHTML = `<span style="color: #0ff">${shortId}:</span> ${this.escapeHtml(message)}`;
    }

    this.log.appendChild(div);
    this.log.scrollTop = this.log.scrollHeight;
    this.log.style.display = 'block';

    if (!this.visible) {
      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
        if (!this.visible) this.log.style.display = 'none';
      }, 5000);
    }
  }

  showInput() {
    this.visible = true;
    this.log.style.display = 'block';
    this.input.style.display = 'block';
    setTimeout(() => { this.input.value = ''; this.input.focus(); }, 20);
  }

  hideInput() {
    this.visible = false;
    this.input.style.display = 'none';
    this.input.value = '';
    this.input.blur();
  }

  isActive() {
    return this.visible && this.input.style.display === 'block';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ─────────────────────────────────────────────
// HUD
// ─────────────────────────────────────────────

class HUD {
  constructor(scene) {
    this.text = scene.add.text(10, 10, '', {
      fontSize: '12px',
      fontFamily: 'monospace',
      color: '#ffffff',
      backgroundColor: '#00000088',
      padding: { x: 6, y: 4 },
    });
    this.text.setScrollFactor(0);
    this.text.setDepth(100);
  }

  update(data) {
    const dot = data.connected ? '🟢' : '🔴';
    const lines = [
      `${dot} ${data.playerName || 'Player'}`,
      `Pos: ${Math.round(data.x)}, ${Math.round(data.y)}`,
      `Zone: ${data.zone || '...'}`,
      `Players: ${data.playerCount}`,
    ];
    this.text.setText(lines.join('\n'));
  }
}

// ─────────────────────────────────────────────
// Profile Picker
// ─────────────────────────────────────────────
// Shows on connect — lets player choose name and color.

class ProfilePicker {
  constructor() {
    this.resolve = null;
    this.selectedColor = COLOR_PRESETS[0].hex;
  }

  show() {
    return new Promise((resolve) => {
      this.resolve = resolve;

      this.overlay = document.createElement('div');
      this.overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85); z-index: 2000;
        display: flex; align-items: center; justify-content: center;
        font-family: monospace;
      `;

      const panel = document.createElement('div');
      panel.style.cssText = `
        background: #1a1a2e; border: 2px solid #0ff; border-radius: 12px;
        padding: 30px; width: 340px; text-align: center;
        box-shadow: 0 0 30px rgba(0,255,255,0.2);
      `;

      const title = document.createElement('h2');
      title.textContent = '⚔ AETHARIA ⚔';
      title.style.cssText = 'color: #0ff; margin: 0 0 6px 0; font-size: 22px; letter-spacing: 3px;';
      panel.appendChild(title);

      const subtitle = document.createElement('div');
      subtitle.textContent = 'Choose your identity';
      subtitle.style.cssText = 'color: #888; margin-bottom: 20px; font-size: 12px;';
      panel.appendChild(subtitle);

      // Name input
      const nameLabel = document.createElement('div');
      nameLabel.textContent = 'NAME';
      nameLabel.style.cssText = 'color: #aaa; text-align: left; font-size: 10px; margin-bottom: 4px; letter-spacing: 2px;';
      panel.appendChild(nameLabel);

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.maxLength = 16;
      nameInput.placeholder = 'Enter your name...';
      nameInput.style.cssText = `
        width: 100%; box-sizing: border-box;
        background: #0d0d1a; color: #fff; border: 1px solid #333;
        padding: 10px; font-family: monospace; font-size: 16px;
        border-radius: 6px; outline: none; margin-bottom: 16px;
      `;
      nameInput.addEventListener('focus', () => { nameInput.style.borderColor = '#0ff'; });
      nameInput.addEventListener('blur', () => { nameInput.style.borderColor = '#333'; });
      panel.appendChild(nameInput);

      // Color picker
      const colorLabel = document.createElement('div');
      colorLabel.textContent = 'COLOR';
      colorLabel.style.cssText = 'color: #aaa; text-align: left; font-size: 10px; margin-bottom: 8px; letter-spacing: 2px;';
      panel.appendChild(colorLabel);

      const colorGrid = document.createElement('div');
      colorGrid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 20px;';

      // Preview square
      const preview = document.createElement('div');
      preview.style.cssText = `
        width: 48px; height: 48px; border-radius: 6px;
        border: 2px solid #fff; margin: 0 auto 16px auto;
        background: ${this.selectedColor};
        transition: background 0.15s;
      `;
      panel.appendChild(preview);

      COLOR_PRESETS.forEach((preset) => {
        const swatch = document.createElement('div');
        swatch.style.cssText = `
          width: 28px; height: 28px; border-radius: 4px; cursor: pointer;
          background: ${preset.hex}; border: 2px solid transparent;
          transition: border-color 0.15s, transform 0.1s;
        `;
        if (preset.hex === this.selectedColor) {
          swatch.style.borderColor = '#fff';
        }
        swatch.addEventListener('click', () => {
          this.selectedColor = preset.hex;
          preview.style.background = preset.hex;
          colorGrid.querySelectorAll('div').forEach(s => s.style.borderColor = 'transparent');
          swatch.style.borderColor = '#fff';
        });
        swatch.addEventListener('mouseenter', () => { swatch.style.transform = 'scale(1.15)'; });
        swatch.addEventListener('mouseleave', () => { swatch.style.transform = 'scale(1)'; });
        colorGrid.appendChild(swatch);
      });
      panel.appendChild(colorGrid);

      // Enter button
      const btn = document.createElement('button');
      btn.textContent = 'ENTER WORLD';
      btn.style.cssText = `
        width: 100%; padding: 12px; background: #0ff; color: #000;
        border: none; border-radius: 6px; font-family: monospace;
        font-size: 14px; font-weight: bold; cursor: pointer;
        letter-spacing: 2px; transition: background 0.15s;
      `;
      btn.addEventListener('mouseenter', () => { btn.style.background = '#00e5ff'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#0ff'; });

      const submit = () => {
        const name = nameInput.value.trim().substring(0, 16) || 'Traveler';
        this.overlay.remove();
        resolve({ name, color: this.selectedColor });
      };

      btn.addEventListener('click', submit);
      nameInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') submit();
      });
      panel.appendChild(btn);

      this.overlay.appendChild(panel);
      document.body.appendChild(this.overlay);

      setTimeout(() => nameInput.focus(), 100);
    });
  }
}

// ─────────────────────────────────────────────
// Block Update Handler (for real-time world changes)
// ─────────────────────────────────────────────

class BlockUpdateHandler {
  constructor(chunkRenderer) {
    this.chunkRenderer = chunkRenderer;
  }

  handle(msg) {
    this.chunkRenderer.updateBlock(msg.x, msg.y, msg.tile);
  }
}

// ─────────────────────────────────────────────
// Main Game Scene
// ─────────────────────────────────────────────

class AethariaScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AethariaScene' });
    this.playerId = null;
    this.playerName = 'Traveler';
    this.playerColor = '#FF5722';
    this.playerSprite = null;
    this.playerLabel = null;
    this.zone = null;
    this.lastSentX = 0;
    this.lastSentY = 0;
    this.worldConfig = null;
    this.profileReady = false;
  }

  preload() {}

  create() {
    this.network = new NetworkManager(WS_URL);
    this.chunkRenderer = new ChunkRenderer(this);
    this.playerManager = new PlayerManager(this);
    this.chat = new ChatManager();
    this.hud = new HUD(this);
    this.blockHandler = new BlockUpdateHandler(this.chunkRenderer);

    this.cameras.main.setBackgroundColor(SKY_COLOR);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = {
      up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.input.keyboard.on('keydown-T', () => {
      if (!this.chat.isActive() && this.profileReady) {
        this.chat.showInput();
      }
    });

    this.chat.onSend = (message) => {
      this.network.send({ type: 'chat', message }, true);
    };

    this.registerNetworkHandlers();
    this.network.connect();
    this.chat.addMessage('', 'Connecting to Aetharia...', true);
  }

  registerNetworkHandlers() {
    // ── Welcome ──
    this.network.on('welcome', async (msg) => {
      console.log(`🎉 Welcome! ID: ${msg.id}, Zone: ${msg.zone}`);
      this.playerId = msg.id;
      this.zone = msg.zone;
      this.worldConfig = msg.worldConfig;

      // Render terrain immediately (behind the picker)
      if (msg.chunks) {
        this.chunkRenderer.addChunks(msg.chunks);
      }

      // Show profile picker
      const picker = new ProfilePicker();
      const profile = await picker.show();

      this.playerName = profile.name;
      this.playerColor = profile.color;

      // Tell the server our name and color
      this.network.send({ type: 'setProfile', name: profile.name, color: profile.color }, true);

      // Create local player sprite
      const spawnPixelX = msg.x * TILE_SIZE + TILE_SIZE / 2;
      const spawnPixelY = msg.y * TILE_SIZE + TILE_SIZE / 2;
      const colorInt = parseInt(profile.color.replace('#', '0x'), 16);

      if (this.playerSprite) this.playerSprite.destroy();
      if (this.playerLabel) this.playerLabel.destroy();

      this.playerSprite = this.add.rectangle(
        spawnPixelX, spawnPixelY,
        TILE_SIZE - 4, TILE_SIZE - 4,
        colorInt
      );
      this.playerSprite.setDepth(20);

      this.playerLabel = this.add.text(spawnPixelX, spawnPixelY - TILE_SIZE / 2 - 2, profile.name, {
        fontSize: '11px',
        fontFamily: 'monospace',
        color: '#ffffff',
        backgroundColor: '#00000088',
        padding: { x: 3, y: 2 },
      });
      this.playerLabel.setOrigin(0.5, 1);
      this.playerLabel.setDepth(21);

      this.lastSentX = msg.x;
      this.lastSentY = msg.y;

      this.cameras.main.startFollow(this.playerSprite, true, 0.1, 0.1);

      this.profileReady = true;
      this.chat.addMessage('', `Welcome to Aetharia, ${profile.name}!`, true);
    });

    // ── Existing Players ──
    this.network.on('existingPlayers', (msg) => {
      for (const p of msg.players) {
        this.playerManager.addPlayer(p.id, p.x, p.y, p.name, p.color);
      }
    });

    // ── Player Joined ──
    this.network.on('playerJoined', (msg) => {
      this.playerManager.addPlayer(msg.id, msg.x, msg.y, msg.name, msg.color);
      const displayName = msg.name || msg.id.substring(0, 6);
      this.chat.addMessage('', `${displayName} joined`, true);
    });

    // ── Player Left ──
    this.network.on('playerLeft', (msg) => {
      const displayName = msg.name || msg.id.substring(0, 6);
      this.playerManager.removePlayer(msg.id);
      this.chat.addMessage('', `${displayName} left`, true);
    });

    // ── Player Moved ──
    this.network.on('playerMoved', (msg) => {
      this.playerManager.updatePlayer(msg.id, msg.x, msg.y);
    });

    // ── Profile Update ──
    this.network.on('profileUpdate', (msg) => {
      this.playerManager.updateProfile(msg.id, msg.name, msg.color);
    });

    // ── Chat Message ──
    this.network.on('chatMessage', (msg) => {
      this.chat.addMessage(msg.id.substring(0, 6), msg.message);
    });

    // ── Chunk Data ──
    this.network.on('chunkData', (msg) => {
      this.chunkRenderer.addChunk(msg.chunk);
    });

    // ── Block Update ──
    this.network.on('blockUpdate', (msg) => {
      this.blockHandler.handle(msg);
    });

    // ── Zone Changed ──
    this.network.on('zoneChanged', (msg) => {
      this.zone = msg.zone;
      this.playerManager.clear();
      this.chat.addMessage('', `Entered ${msg.zone}`, true);
    });

    // ── Error ──
    this.network.on('error', (msg) => {
      console.warn(`⚠️ Server error: ${msg.message}`);
    });

    // ── Interact Result ──
    this.network.on('interactResult', (msg) => {
      this.chat.addMessage('', msg.message, true);
    });
  }

  update(time, delta) {
    if (!this.playerSprite || !this.playerId || !this.profileReady) return;

    if (this.chat.isActive()) {
      this.updateHUD();
      return;
    }

    let vx = 0;
    let vy = 0;
    if (this.cursors.left.isDown || this.wasd.left.isDown) vx = -PLAYER_SPEED;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx = PLAYER_SPEED;
    if (this.cursors.up.isDown || this.wasd.up.isDown) vy = -PLAYER_SPEED;
    if (this.cursors.down.isDown || this.wasd.down.isDown) vy = PLAYER_SPEED;

    if (vx !== 0 && vy !== 0) {
      const factor = 1 / Math.SQRT2;
      vx *= factor;
      vy *= factor;
    }

    const dx = vx * (delta / 1000);
    const dy = vy * (delta / 1000);
    this.playerSprite.x += dx;
    this.playerSprite.y += dy;

    // Move name label with player
    if (this.playerLabel) {
      this.playerLabel.setPosition(this.playerSprite.x, this.playerSprite.y - TILE_SIZE / 2 - 2);
    }

    const tileX = (this.playerSprite.x - TILE_SIZE / 2) / TILE_SIZE;
    const tileY = (this.playerSprite.y - TILE_SIZE / 2) / TILE_SIZE;

    if (tileX !== this.lastSentX || tileY !== this.lastSentY) {
      this.network.send({ type: 'move', x: tileX, y: tileY });
      this.lastSentX = tileX;
      this.lastSentY = tileY;
    }

    const missing = this.chunkRenderer.getMissingChunks(
      this.playerSprite.x,
      this.playerSprite.y
    );
    for (const chunk of missing) {
      this.network.send({
        type: 'requestChunk',
        chunkX: chunk.chunkX,
        chunkY: chunk.chunkY,
      }, true);
    }

    this.updateHUD();
  }

  updateHUD() {
    const tileX = this.playerSprite
      ? (this.playerSprite.x - TILE_SIZE / 2) / TILE_SIZE : 0;
    const tileY = this.playerSprite
      ? (this.playerSprite.y - TILE_SIZE / 2) / TILE_SIZE : 0;
    this.hud.update({
      x: tileX,
      y: tileY,
      zone: this.zone,
      playerName: this.playerName,
      playerCount: Object.keys(this.playerManager.players).length + 1,
      connected: this.network.connected,
    });
  }
}

// ─────────────────────────────────────────────
// Phaser Game Configuration
// ─────────────────────────────────────────────
const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: SKY_COLOR,
  parent: 'game-container',
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false },
  },
  scene: [AethariaScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);
console.log('🌍 AETHARIA client initialized');
console.log(`📡 Server: ${WS_URL}`);
