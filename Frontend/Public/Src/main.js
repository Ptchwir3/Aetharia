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
const WS_HOST = params.get('server') || window.location.hostname + ':8080';
const WS_URL = `ws://${WS_HOST}`;

const SEND_RATE = 50;
const TILE_SIZE = 32;
const CHUNK_SIZE = 32;
const PLAYER_SPEED = 200;
const GRAVITY = 600;
const JUMP_VELOCITY = -280;
const MAX_FALL_SPEED = 500;
const SOLID_TILES = [1, 2, 3, 5, 6, 7];
const WORLD_TILES = { AIR: 0, DIRT: 1, STONE: 2, GRASS: 3, WATER: 4, SAND: 5, WOOD: 6, LEAVES: 7 }; // Everything except AIR(0) and WATER(4)

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
    this.intentionalClose = false;
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
      if (!this.intentionalClose) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
      this.intentionalClose = false;
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
      chunkEntry.graphics.fillStyle(0x87CEEB, 1);
    } else {
      chunkEntry.graphics.fillStyle(color, 1);
    }
    chunkEntry.graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);

    // Also update the cached tile data so collision detection stays accurate
    if (chunkEntry.data && chunkEntry.data.tiles) {
      chunkEntry.data.tiles[localY][localX] = tile;
    }
  }

  // Get tile type at a world tile position (for collision detection)
  getTileAt(worldTileX, worldTileY) {
    const chunkX = Math.floor(worldTileX / CHUNK_SIZE);
    const chunkY = Math.floor(worldTileY / CHUNK_SIZE);
    const key = `${chunkX},${chunkY}`;
    const chunkEntry = this.chunks[key];
    if (!chunkEntry || !chunkEntry.data || !chunkEntry.data.tiles) return 0;
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
      `💰 ${data.credits || 0} credits`,
      `Pos: ${Math.round(data.x)}, ${Math.round(data.y)}`,
      `Zone: ${data.zone || '...'}`,
      `Players: ${data.playerCount}`,
    ];
    this.text.setText(lines.join('\n'));
  }
}

// ─────────────────────────────────────────────
// Block Names
// ─────────────────────────────────────────────

const BLOCK_NAMES = {
  1: 'Dirt', 2: 'Stone', 3: 'Grass', 4: 'Water', 5: 'Sand', 6: 'Wood', 7: 'Leaves',
};

const BLOCK_COLORS_HEX = {
  1: '#8B6914', 2: '#808080', 3: '#228B22', 4: '#4169E1', 5: '#FFD700', 6: '#8B4513', 7: '#006400',
};

// ─────────────────────────────────────────────
// Hotbar
// ─────────────────────────────────────────────

class Hotbar {
  constructor(scene) {
    this.scene = scene;
    this.slots = [];
    this.elements = []; // track all elements for repositioning
    this.selectedIndex = 0;
    this.inventory = [];
    this.slotCount = 9;
    this.slotSize = 44;
    this.padding = 4;
    this.built = false;
  }

  build() {
    // Destroy old elements if rebuilding
    this.elements.forEach(e => e.destroy());
    this.elements = [];
    this.slots = [];

    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const totalWidth = this.slotCount * (this.slotSize + this.padding) - this.padding;
    const startX = (w - totalWidth) / 2;
    const y = h - this.slotSize - 12;

    // Background bar
    const bg = this.scene.add.rectangle(
      w / 2, y + this.slotSize / 2,
      totalWidth + 16, this.slotSize + 12,
      0x000000, 0.6
    );
    bg.setScrollFactor(0);
    bg.setDepth(199);
    this.elements.push(bg);

    for (let i = 0; i < this.slotCount; i++) {
      const x = startX + i * (this.slotSize + this.padding);

      const slotBg = this.scene.add.rectangle(
        x + this.slotSize / 2, y + this.slotSize / 2,
        this.slotSize, this.slotSize,
        0x1a1a2e, 0.8
      );
      slotBg.setStrokeStyle(2, i === 0 ? 0x00ffff : 0x444444);
      slotBg.setScrollFactor(0);
      slotBg.setDepth(200);
      this.elements.push(slotBg);

      const swatch = this.scene.add.rectangle(
        x + this.slotSize / 2, y + this.slotSize / 2 - 2,
        24, 24, 0x000000, 0
      );
      swatch.setScrollFactor(0);
      swatch.setDepth(201);
      this.elements.push(swatch);

      const qty = this.scene.add.text(x + this.slotSize - 4, y + this.slotSize - 4, '', {
        fontSize: '10px', fontFamily: 'monospace', color: '#ffffff',
      });
      qty.setOrigin(1, 1);
      qty.setScrollFactor(0);
      qty.setDepth(202);
      this.elements.push(qty);

      const keyNum = this.scene.add.text(x + 4, y + 2, String(i + 1), {
        fontSize: '8px', fontFamily: 'monospace', color: '#666666',
      });
      keyNum.setScrollFactor(0);
      keyNum.setDepth(202);
      this.elements.push(keyNum);

      this.slots.push({ bg: slotBg, swatch, qty, keyNum });
    }

    this.built = true;
    this.refresh();

    // Rebuild on window resize
    this.scene.scale.on('resize', () => {
      this.built = false;
      this.build();
    });
  }

  setInventory(inventory) {
    this.inventory = inventory || [];
    console.log('📦 Hotbar setInventory called, items:', this.inventory.length);
    try {
      if (!this.built) {
        console.log('📦 Building hotbar...');
        this.build();
      }
      this.refresh();
    } catch(e) {
      console.error('📦 Hotbar error:', e);
    }
  }

  refresh() {
    for (let i = 0; i < this.slotCount; i++) {
      const slot = this.slots[i];
      const item = this.inventory[i];

      // Update selection highlight
      slot.bg.setStrokeStyle(2, i === this.selectedIndex ? 0x00ffff : 0x444444);

      if (item && item.quantity > 0) {
        const colorHex = BLOCK_COLORS_HEX[item.tile] || '#ffffff';
        const colorInt = parseInt(colorHex.replace('#', '0x'), 16);
        slot.swatch.setFillStyle(colorInt, 1);
        slot.qty.setText(item.quantity.toString());
      } else {
        slot.swatch.setFillStyle(0x000000, 0);
        slot.qty.setText('');
      }
    }
  }

  selectSlot(index) {
    if (index < 0 || index >= this.slotCount) return;
    this.selectedIndex = index;
    this.refresh();
  }

  getSelectedItem() {
    return this.inventory[this.selectedIndex] || null;
  }

  scrollSlot(direction) {
    this.selectedIndex = (this.selectedIndex + direction + this.slotCount) % this.slotCount;
    this.refresh();
  }
}

// ─────────────────────────────────────────────
// Block Interaction
// ─────────────────────────────────────────────

class BlockInteraction {
  constructor(scene, chunkRenderer, network, hotbar) {
    this.scene = scene;
    this.chunkRenderer = chunkRenderer;
    this.network = network;
    this.hotbar = hotbar;
    this.highlight = null;
    this.maxRange = 5;
    this.enabled = false;

    // Create highlight overlay
    this.highlight = scene.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, 0xffffff, 0.2);
    this.highlight.setDepth(15);
    this.highlight.setVisible(false);

    // Mouse/pointer events
    scene.input.on('pointermove', (pointer) => this.onPointerMove(pointer));
    scene.input.on('pointerdown', (pointer) => this.onPointerDown(pointer));
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }

  getWorldTile(pointer) {
    const worldX = pointer.worldX;
    const worldY = pointer.worldY;
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    return { tileX, tileY, worldX, worldY };
  }

  isInRange(tileX, tileY) {
    if (!this.scene.playerSprite) return false;
    const playerTileX = Math.floor(this.scene.playerSprite.x / TILE_SIZE);
    const playerTileY = Math.floor(this.scene.playerSprite.y / TILE_SIZE);
    const dx = Math.abs(tileX - playerTileX);
    const dy = Math.abs(tileY - playerTileY);
    return dx <= this.maxRange && dy <= this.maxRange;
  }

  onPointerMove(pointer) {
    if (!this.enabled) { this.highlight.setVisible(false); return; }
    const { tileX, tileY } = this.getWorldTile(pointer);

    if (this.isInRange(tileX, tileY)) {
      this.highlight.setPosition(tileX * TILE_SIZE + TILE_SIZE / 2, tileY * TILE_SIZE + TILE_SIZE / 2);
      this.highlight.setVisible(true);

      const tile = this.chunkRenderer.getTileAt(tileX, tileY);
      if (SOLID_TILES.includes(tile)) {
        this.highlight.setFillStyle(0xff0000, 0.2); // Red = can mine
      } else {
        this.highlight.setFillStyle(0x00ff00, 0.2); // Green = can place
      }
    } else {
      this.highlight.setVisible(false);
    }
  }

  onPointerDown(pointer) {
    if (!this.enabled) return;
    if (this.scene.chat && this.scene.chat.isActive()) return;

    const { tileX, tileY } = this.getWorldTile(pointer);
    if (!this.isInRange(tileX, tileY)) return;

    const currentTile = this.chunkRenderer.getTileAt(tileX, tileY);

    if (pointer.rightButtonDown() || pointer.event.shiftKey) {
      // Mine / remove block
      if (SOLID_TILES.includes(currentTile)) {
        this.network.send({ type: 'removeBlock', x: tileX, y: tileY });
        this.flashTile(tileX, tileY, 0xffffff);
      }
    } else {
      // Place block from hotbar
      const item = this.hotbar.getSelectedItem();
      if (item && item.quantity > 0 && !SOLID_TILES.includes(currentTile)) {
        this.network.send({ type: 'placeBlock', x: tileX, y: tileY, tile: item.tile });
        this.flashTile(tileX, tileY, 0x00ffff);
      }
    }
  }

  flashTile(tileX, tileY, color) {
    const flash = this.scene.add.rectangle(
      tileX * TILE_SIZE + TILE_SIZE / 2, tileY * TILE_SIZE + TILE_SIZE / 2,
      TILE_SIZE, TILE_SIZE, color, 0.5
    );
    flash.setDepth(16);
    this.scene.tweens.add({
      targets: flash, alpha: 0, duration: 200,
      onComplete: () => flash.destroy(),
    });
  }
}

// ─────────────────────────────────────────────
// Auth Screen
// ─────────────────────────────────────────────

class AuthScreen {
  constructor(network) {
    this.network = network;
    this.resolve = null;
    this.selectedColor = COLOR_PRESETS[0].hex;
    this.mode = 'login'; // 'login' or 'register'
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

      this.subtitle = document.createElement('div');
      this.subtitle.textContent = 'Welcome back';
      this.subtitle.style.cssText = 'color: #888; margin-bottom: 20px; font-size: 12px;';
      panel.appendChild(this.subtitle);

      // Error display
      this.errorDiv = document.createElement('div');
      this.errorDiv.style.cssText = `
        color: #ff4444; font-size: 12px; margin-bottom: 12px;
        display: none; background: rgba(255,0,0,0.1);
        padding: 8px; border-radius: 4px;
      `;
      panel.appendChild(this.errorDiv);

      // Username
      const nameLabel = document.createElement('div');
      nameLabel.textContent = 'USERNAME';
      nameLabel.style.cssText = 'color: #aaa; text-align: left; font-size: 10px; margin-bottom: 4px; letter-spacing: 2px;';
      panel.appendChild(nameLabel);

      this.nameInput = document.createElement('input');
      this.nameInput.type = 'text';
      this.nameInput.maxLength = 16;
      this.nameInput.placeholder = 'Enter username...';
      this.nameInput.style.cssText = `
        width: 100%; box-sizing: border-box;
        background: #0d0d1a; color: #fff; border: 1px solid #333;
        padding: 10px; font-family: monospace; font-size: 16px;
        border-radius: 6px; outline: none; margin-bottom: 12px;
      `;
      this.nameInput.addEventListener('focus', () => { this.nameInput.style.borderColor = '#0ff'; });
      this.nameInput.addEventListener('blur', () => { this.nameInput.style.borderColor = '#333'; });
      panel.appendChild(this.nameInput);

      // Password
      const passLabel = document.createElement('div');
      passLabel.textContent = 'PASSWORD';
      passLabel.style.cssText = 'color: #aaa; text-align: left; font-size: 10px; margin-bottom: 4px; letter-spacing: 2px;';
      panel.appendChild(passLabel);

      this.passInput = document.createElement('input');
      this.passInput.type = 'password';
      this.passInput.maxLength = 64;
      this.passInput.placeholder = 'Enter password...';
      this.passInput.style.cssText = `
        width: 100%; box-sizing: border-box;
        background: #0d0d1a; color: #fff; border: 1px solid #333;
        padding: 10px; font-family: monospace; font-size: 16px;
        border-radius: 6px; outline: none; margin-bottom: 12px;
      `;
      this.passInput.addEventListener('focus', () => { this.passInput.style.borderColor = '#0ff'; });
      this.passInput.addEventListener('blur', () => { this.passInput.style.borderColor = '#333'; });
      panel.appendChild(this.passInput);

      // Confirm password (register only)
      this.confirmSection = document.createElement('div');
      this.confirmSection.style.cssText = 'display: none;';

      const confirmLabel = document.createElement('div');
      confirmLabel.textContent = 'CONFIRM PASSWORD';
      confirmLabel.style.cssText = 'color: #aaa; text-align: left; font-size: 10px; margin-bottom: 4px; letter-spacing: 2px;';
      this.confirmSection.appendChild(confirmLabel);

      this.confirmInput = document.createElement('input');
      this.confirmInput.type = 'password';
      this.confirmInput.maxLength = 64;
      this.confirmInput.placeholder = 'Confirm password...';
      this.confirmInput.style.cssText = `
        width: 100%; box-sizing: border-box;
        background: #0d0d1a; color: #fff; border: 1px solid #333;
        padding: 10px; font-family: monospace; font-size: 16px;
        border-radius: 6px; outline: none; margin-bottom: 12px;
      `;
      this.confirmInput.addEventListener('focus', () => { this.confirmInput.style.borderColor = '#0ff'; });
      this.confirmInput.addEventListener('blur', () => { this.confirmInput.style.borderColor = '#333'; });
      this.confirmInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.submit(); });
      this.confirmSection.appendChild(this.confirmInput);
      panel.appendChild(this.confirmSection);

      // Color picker (hidden in login mode, shown in register)
      this.colorSection = document.createElement('div');
      this.colorSection.style.cssText = 'display: none;';

      const colorLabel = document.createElement('div');
      colorLabel.textContent = 'COLOR';
      colorLabel.style.cssText = 'color: #aaa; text-align: left; font-size: 10px; margin-bottom: 8px; letter-spacing: 2px;';
      this.colorSection.appendChild(colorLabel);

      const preview = document.createElement('div');
      preview.style.cssText = `
        width: 48px; height: 48px; border-radius: 6px;
        border: 2px solid #fff; margin: 0 auto 12px auto;
        background: ${this.selectedColor}; transition: background 0.15s;
      `;
      this.colorSection.appendChild(preview);

      const colorGrid = document.createElement('div');
      colorGrid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 16px;';

      COLOR_PRESETS.forEach((preset) => {
        const swatch = document.createElement('div');
        swatch.style.cssText = `
          width: 28px; height: 28px; border-radius: 4px; cursor: pointer;
          background: ${preset.hex}; border: 2px solid transparent;
          transition: border-color 0.15s, transform 0.1s;
        `;
        if (preset.hex === this.selectedColor) swatch.style.borderColor = '#fff';
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
      this.colorSection.appendChild(colorGrid);
      panel.appendChild(this.colorSection);

      // Submit button
      this.btn = document.createElement('button');
      this.btn.textContent = 'LOG IN';
      this.btn.style.cssText = `
        width: 100%; padding: 12px; background: #0ff; color: #000;
        border: none; border-radius: 6px; font-family: monospace;
        font-size: 14px; font-weight: bold; cursor: pointer;
        letter-spacing: 2px; transition: background 0.15s;
        margin-bottom: 12px;
      `;
      this.btn.addEventListener('mouseenter', () => { this.btn.style.background = '#00e5ff'; });
      this.btn.addEventListener('mouseleave', () => { this.btn.style.background = '#0ff'; });
      this.btn.addEventListener('click', () => this.submit());
      panel.appendChild(this.btn);

      // Toggle link
      this.toggleLink = document.createElement('div');
      this.toggleLink.innerHTML = 'No account? <span style="color:#0ff;cursor:pointer;text-decoration:underline;">Create one</span>';
      this.toggleLink.style.cssText = 'color: #666; font-size: 11px;';
      this.toggleLink.querySelector('span').addEventListener('click', () => this.toggleMode());
      panel.appendChild(this.toggleLink);

      // Listen for auth errors from server
      this.authErrorHandler = (msg) => {
        this.showError(msg.message);
        this.btn.disabled = false;
        this.btn.textContent = this.mode === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
      };
      this.network.on('authError', this.authErrorHandler);

      // Listen for welcome (auth succeeded)
      this.welcomeHandler = (msg) => {
        this.overlay.remove();
        resolve(msg);
      };
      this.network.on('welcome', this.welcomeHandler);

      // Handle enter key on inputs
      const handleEnter = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') this.submit();
      };
      this.nameInput.addEventListener('keydown', handleEnter);
      this.passInput.addEventListener('keydown', handleEnter);

      this.overlay.appendChild(panel);
      document.body.appendChild(this.overlay);
      setTimeout(() => this.nameInput.focus(), 100);
    });
  }

  toggleMode() {
    if (this.mode === 'login') {
      this.mode = 'register';
      this.subtitle.textContent = 'Create your identity';
      this.btn.textContent = 'CREATE ACCOUNT';
      this.colorSection.style.display = 'block';
      this.confirmSection.style.display = 'block';
      this.toggleLink.innerHTML = 'Already have an account? <span style="color:#0ff;cursor:pointer;text-decoration:underline;">Log in</span>';
    } else {
      this.mode = 'login';
      this.subtitle.textContent = 'Welcome back';
      this.btn.textContent = 'LOG IN';
      this.colorSection.style.display = 'none';
      this.confirmSection.style.display = 'none';
      this.toggleLink.innerHTML = 'No account? <span style="color:#0ff;cursor:pointer;text-decoration:underline;">Create one</span>';
    }
    this.toggleLink.querySelector('span').addEventListener('click', () => this.toggleMode());
    this.hideError();
  }

  submit() {
    const username = this.nameInput.value.trim();
    const password = this.passInput.value;

    if (!username || username.length < 3) {
      this.showError('Username must be at least 3 characters');
      return;
    }
    if (!password || password.length < 4) {
      this.showError('Password must be at least 4 characters');
      return;
    }

    if (this.mode === 'register' && password !== this.confirmInput.value) {
      this.showError('Passwords do not match');
      return;
    }

    this.hideError();
    this.btn.disabled = true;
    this.btn.textContent = this.mode === 'login' ? 'LOGGING IN...' : 'CREATING...';

    if (this.mode === 'login') {
      this.network.send({ type: 'login', username, password }, true);
    } else {
      this.network.send({ type: 'register', username, password, color: this.selectedColor }, true);
    }
  }

  showError(msg) {
    this.errorDiv.textContent = msg;
    this.errorDiv.style.display = 'block';
  }

  hideError() {
    this.errorDiv.style.display = 'none';
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
    this.playerCredits = 0;
    this.velocityY = 0;
    this.onGround = false;
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
    this.spaceBar = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Logout button (L key)
    this.input.keyboard.on('keydown-L', () => {
      if (!this.chat.isActive() && this.profileReady) {
        this.logout();
      }
    });

    // Hotbar number keys 1-9
    for (let i = 1; i <= 9; i++) {
      this.input.keyboard.on(`keydown-${i === 1 ? 'ONE' : i === 2 ? 'TWO' : i === 3 ? 'THREE' : i === 4 ? 'FOUR' : i === 5 ? 'FIVE' : i === 6 ? 'SIX' : i === 7 ? 'SEVEN' : i === 8 ? 'EIGHT' : 'NINE'}`, () => {
        if (!this.chat.isActive()) this.hotbar.selectSlot(i - 1);
      });
    }

    // Scroll wheel for hotbar
    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
      if (!this.chat.isActive()) {
        this.hotbar.scrollSlot(deltaY > 0 ? 1 : -1);
      }
    });

    // Right-click context menu prevention
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.input.keyboard.on('keydown-T', () => {
      if (!this.chat.isActive() && this.profileReady) {
        this.chat.showInput();
      }
    });

    this.chat.onSend = (message) => {
      this.network.send({ type: 'chat', message }, true);
    };

    // Hotbar
    this.hotbar = new Hotbar(this);

    // Block interaction (mouse mining/placing)
    this.blockInteraction = new BlockInteraction(this, this.chunkRenderer, this.network, this.hotbar);

    this.registerNetworkHandlers();
    this.network.connect();
    this.chat.addMessage('', 'Connecting to Aetharia...', true);
  }

  registerNetworkHandlers() {
    // ── Welcome ──
    // ── Auth Required — show login/register screen ──
    this.network.on('authRequired', () => {
      console.log('🔐 Server requires authentication');
      const authScreen = new AuthScreen(this.network);
      authScreen.show().then((msg) => {
        this.handleWelcome(msg);
      });
    });

    this.network.on('welcome', (msg) => {
      // If we get welcome directly (shouldn't happen with auth), handle it
      if (!this.playerId) this.handleWelcome(msg);
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

    // ── Position Correction (server-side gravity) ──
    this.network.on('positionCorrection', (msg) => {
      if (!this.playerSprite) return;
      const serverPixelX = msg.x * TILE_SIZE + TILE_SIZE / 2;
      const serverPixelY = msg.y * TILE_SIZE + TILE_SIZE / 2;
      this.playerSprite.x = serverPixelX;
      this.playerSprite.y = serverPixelY;
      this.onGround = msg.onGround;
      if (msg.onGround) this.velocityY = 0;

      // Immediately request chunks around corrected position
      const missing = this.chunkRenderer.getMissingChunks(serverPixelX, serverPixelY);
      for (const chunk of missing) {
        this.network.send({ type: 'requestChunk', chunkX: chunk.chunkX, chunkY: chunk.chunkY }, true);
      }
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

    // ── Inventory Update ──
    this.network.on('inventoryUpdate', (msg) => {
      if (this.hotbar && msg.inventory) {
        this.hotbar.setInventory(msg.inventory);
        // Update credits display
        const player = msg;
        if (msg.credits !== undefined) this.playerCredits = msg.credits;
      }
    });
  }

  handleWelcome(msg) {
      console.log(`🎉 Welcome! ID: ${msg.id}, Zone: ${msg.zone}`);
      console.log('📦 Welcome msg keys:', Object.keys(msg));
      console.log('📦 Inventory:', JSON.stringify(msg.inventory));
      console.log('📦 Hotbar exists:', !!this.hotbar);
      this.playerId = msg.id;
      this.zone = msg.zone;
      this.worldConfig = msg.worldConfig;

      if (msg.chunks) {
        this.chunkRenderer.addChunks(msg.chunks);
      }

      this.playerName = msg.name;
      this.playerColor = msg.color;
      this.playerCredits = msg.credits || 0;

      // Find the surface at spawn X so we start on the ground
      let spawnTileX = Math.round(msg.x);
      let spawnTileY = Math.round(msg.y);

      // First check if spawn is inside solid ground — scan UP to find air
      const spawnTile = this.chunkRenderer.getTileAt(spawnTileX, spawnTileY);
      if (SOLID_TILES.includes(spawnTile)) {
        for (let y = spawnTileY; y > spawnTileY - 50; y--) {
          const tile = this.chunkRenderer.getTileAt(spawnTileX, y);
          if (!SOLID_TILES.includes(tile)) {
            spawnTileY = y;
            break;
          }
        }
      } else {
        // Spawn is in air — scan DOWN to find ground
        for (let y = spawnTileY; y < spawnTileY + 50; y++) {
          const tile = this.chunkRenderer.getTileAt(spawnTileX, y);
          if (SOLID_TILES.includes(tile)) {
            spawnTileY = y - 1;
            break;
          }
        }
      }

      const spawnPixelX = spawnTileX * TILE_SIZE + TILE_SIZE / 2;
      const spawnPixelY = spawnTileY * TILE_SIZE + TILE_SIZE / 2;
      const colorInt = parseInt(this.playerColor.replace('#', '0x'), 16);

      if (this.playerSprite) this.playerSprite.destroy();
      if (this.playerLabel) this.playerLabel.destroy();

      this.playerSprite = this.add.rectangle(
        spawnPixelX, spawnPixelY,
        TILE_SIZE - 4, TILE_SIZE - 4,
        colorInt
      );
      this.playerSprite.setDepth(20);

      this.playerLabel = this.add.text(spawnPixelX, spawnPixelY - TILE_SIZE / 2 - 2, this.playerName, {
        fontSize: '11px',
        fontFamily: 'monospace',
        color: '#ffffff',
        backgroundColor: '#00000088',
        padding: { x: 3, y: 2 },
      });
      this.playerLabel.setOrigin(0.5, 1);
      this.playerLabel.setDepth(21);

      this.lastSentX = spawnTileX;
      this.lastSentY = spawnTileY;

      this.cameras.main.startFollow(this.playerSprite, true, 0.1, 0.1);

      this.velocityY = 0;
      this.onGround = false;
      this.profileReady = true;

      // Populate hotbar with inventory from server
      if (this.hotbar && msg.inventory) {
        this.hotbar.setInventory(msg.inventory);
      }

      // Enable block interaction
      if (this.blockInteraction) this.blockInteraction.enable();

      this.chat.addMessage('', `Welcome to Aetharia, ${this.playerName}!`, true);
  }
  logout() {
    // Disconnect and show auth screen again
    this.profileReady = false;
    if (this.blockInteraction) this.blockInteraction.disable();
    if (this.playerSprite) { this.playerSprite.destroy(); this.playerSprite = null; }
    if (this.playerLabel) { this.playerLabel.destroy(); this.playerLabel = null; }
    this.playerManager.clear();
    this.playerId = null;
    this.playerName = 'Traveler';
    this.playerCredits = 0;

    // Intentional disconnect — prevent auto-reconnect
    this.network.intentionalClose = true;
    if (this.network.ws) {
      this.network.ws.close();
    }
    // Reconnect after a short delay — will trigger authRequired again
    setTimeout(() => {
      this.network.reconnectDelay = 1000;
      this.network.connect();
    }, 500);
  }

  update(time, delta) {
    if (!this.playerSprite || !this.playerId || !this.profileReady) return;

    if (this.chat.isActive()) {
      this.updateHUD();
      return;
    }

    // ── Helper: check if a world tile is solid ──
    const isSolid = (tX, tY) => {
      const tile = this.chunkRenderer.getTileAt(Math.floor(tX), Math.floor(tY));
      return SOLID_TILES.includes(tile);
    };

    // ── Unstick: if player is embedded in solid, push up ──
    const curTileX = (this.playerSprite.x - TILE_SIZE / 2) / TILE_SIZE;
    const curTileY = (this.playerSprite.y - TILE_SIZE / 2) / TILE_SIZE;
    if (isSolid(curTileX + 0.5, curTileY + 0.5)) {
      this.playerSprite.y -= TILE_SIZE;
      this.velocityY = 0;
      return; // Skip this frame, try again next
    }

    // ── Horizontal movement ──
    let vx = 0;
    if (this.cursors.left.isDown || this.wasd.left.isDown) vx = -PLAYER_SPEED;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx = PLAYER_SPEED;

    const dx = vx * (delta / 1000);
    let newX = this.playerSprite.x + dx;

    // Horizontal collision — check tile at player's body
    const playerTileY = (this.playerSprite.y - TILE_SIZE / 2) / TILE_SIZE;
    const checkX = (newX - TILE_SIZE / 2) / TILE_SIZE + (vx > 0 ? 0.9 : 0);
    if (vx !== 0 && (isSolid(checkX, playerTileY + 0.1) || isSolid(checkX, playerTileY + 0.9))) {
      newX = this.playerSprite.x; // Block horizontal movement
    }
    this.playerSprite.x = newX;

    // ── Gravity + Jumping ──
    const jumpPressed = this.cursors.up.isDown || this.wasd.up.isDown || this.spaceBar.isDown;
    if (jumpPressed && this.onGround) {
      this.velocityY = JUMP_VELOCITY;
      this.onGround = false;
    }

    this.velocityY += GRAVITY * (delta / 1000);
    if (this.velocityY > MAX_FALL_SPEED) this.velocityY = MAX_FALL_SPEED;

    const dy = this.velocityY * (delta / 1000);
    let newY = this.playerSprite.y + dy;

    // Vertical collision
    const newTileX = (this.playerSprite.x - TILE_SIZE / 2) / TILE_SIZE;
    const leftEdge = newTileX + 0.1;
    const rightEdge = newTileX + 0.9;

    if (this.velocityY > 0) {
      // Falling — check below feet
      const feetCheckY = (newY - TILE_SIZE / 2) / TILE_SIZE + 1.0;
      if (isSolid(leftEdge, feetCheckY) || isSolid(rightEdge, feetCheckY)) {
        // Snap to top of the tile we hit
        const landTileY = Math.floor(feetCheckY);
        newY = landTileY * TILE_SIZE - TILE_SIZE / 2;
        this.velocityY = 0;
        this.onGround = true;
      } else {
        this.onGround = false;
      }
    } else if (this.velocityY < 0) {
      // Jumping — check above head
      const headCheckY = (newY - TILE_SIZE / 2) / TILE_SIZE;
      if (isSolid(leftEdge, headCheckY) || isSolid(rightEdge, headCheckY)) {
        const bonkTileY = Math.floor(headCheckY) + 1;
        newY = bonkTileY * TILE_SIZE + TILE_SIZE / 2;
        this.velocityY = 0;
      }
    }
    this.playerSprite.y = newY;

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
      credits: this.playerCredits || 0,
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
