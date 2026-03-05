# AETHARIA → OASIS: 6-Day Build Plan

> Transform Aetharia from a multiplayer terrain demo into a functioning OASIS-style metaverse MVP.
> Each day builds on the previous. Follow in order.

---

## Day 1: Persistent Identity & Authentication ✅

**Goal:** Players have accounts that survive across sessions.

### Backend

- [x] Install `better-sqlite3` dependency
- [x] Create `Backend/Src/Database/db.js` — initialize SQLite, create tables on first run
- [x] Player table schema:
```
  players: id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT,
           color TEXT, x REAL, y REAL, zone TEXT, inventory TEXT,
           credits INTEGER DEFAULT 100, created_at TEXT, last_login TEXT
```
- [x] Create `Backend/Src/Handlers/handleAuth.js`:
  - [x] `register` handler — validate username (3-16 chars, alphanumeric), hash password (bcrypt), create record
  - [x] `login` handler — verify password, load saved state, return saved position/inventory/credits
- [x] Update `main.js` connection flow:
  - [x] On connect: send `authRequired` message instead of `welcome`
  - [x] Wait for `register` or `login` message before creating player
  - [x] On successful auth: load saved state, assign to zone, send `welcome` with full state
- [x] Add auto-save: save player state to DB every 60 seconds
- [x] On disconnect: save current position, inventory, credits to DB
- [x] Add `credits` field to player object in `player.js`
- [x] Include `credits` in `welcome` message payload
- [ ] Add `SESSION_SECRET` env var for signing tokens (deferred to Day 3 — needed for JWT portals)

### Frontend

- [x] Replace `ProfilePicker` class with `AuthScreen` class:
  - [x] Two modes: Login and Register
  - [x] Register: username, password, confirm password, color picker
  - [x] Login: username, password
  - [x] Toggle link between "Already have an account?" / "Create new account"
  - [x] Error display (username taken, wrong password, etc.)
  - [x] Same visual style as current profile picker (dark theme, cyan accents)
- [x] Update welcome handler to use saved state from server (position, color, credits)
- [x] Add credits display to HUD
- [x] Logout functionality (L key — disconnect, reconnect, show auth screen)
- [ ] Store auth token in sessionStorage for reconnection within same tab (deferred to Day 3)

### Docker

- [x] Add SQLite volume to `docker-compose.yml` (`aetharia-data` volume)
- [x] Set `DATABASE_PATH=/app/data/aetharia.db` env var

### Testing

- [x] Register a new account → spawns with default state
- [x] Disconnect → reconnect → login → same position and color
- [x] Try duplicate username → error
- [x] Try wrong password → error (tested via auth handler)
- [ ] Two players logged in simultaneously → both work independently (not yet tested)

### Definition of Done
**Register, log out, close browser, come back, log in — same character, same position, same color, same credits.** ✅

---

## Day 2: Inventory System & Block Interaction ✅

**Goal:** Players mine blocks, collect them, place them from inventory.

### Backend

- [x] Define inventory item structure: `{ name: string, tile: number, quantity: number }`
- [x] Update `handleRemoveBlock`:
  - [x] On successful block removal, add the block type to player's inventory
  - [x] Send `inventoryUpdate` message to the player
- [x] Update `handlePlaceBlock`:
  - [x] Check player has the block type in inventory
  - [x] Deduct from inventory on successful placement
  - [x] Send `inventoryUpdate` message
  - [x] Reject placement if inventory doesn't have the item
- [x] New message type `MSG.INVENTORY_UPDATE = 'inventoryUpdate'` in constants (added Day 1)
- [x] Starter kit: new players spawn with `[{ name: "stone", tile: 2, quantity: 20 }, { name: "wood", tile: 6, quantity: 10 }]`
- [x] Save inventory to DB on auto-save and disconnect (JSON stringified) (from Day 1)
- [x] Load inventory from DB on login (from Day 1)

### Frontend

- [x] Create `Hotbar` class:
  - [x] 9 slots displayed at bottom center of screen
  - [x] Each slot shows: block color swatch + quantity count
  - [x] Selected slot has a highlight border (cyan)
  - [x] Number keys 1-9 select slots
  - [x] Scroll wheel cycles through slots
  - [x] Fixed to camera (HUD layer), rebuilds on resize
- [x] Create `BlockInteraction` class:
  - [x] Track mouse/cursor position → convert to world tile coordinates
  - [x] Highlight tile under cursor (red=minable, green=placeable)
  - [x] Left click: place selected block from hotbar at cursor position
  - [x] Right click (or Shift+click): mine/remove block at cursor position
  - [x] Range check on client side (max 5 tiles from player)
  - [x] Visual feedback: brief flash on place/mine
- [x] Handle `inventoryUpdate` message:
  - [x] Update hotbar display with new inventory state
- [x] Add inventory to welcome handler (populate hotbar on login)
- [x] Block name mapping for display: `{ 1: "Dirt", 2: "Stone", 3: "Grass", 4: "Water", 5: "Sand", 6: "Wood", 7: "Leaves" }`

### Testing

- [x] Mine a dirt block → appears in inventory hotbar
- [x] Select stone in hotbar → click to place → stone appears in world, quantity decreases
- [x] Try to place with 0 quantity → nothing happens (server rejects)
- [x] Mine several blocks → disconnect → login → inventory preserved
- [x] Other players see blocks placed/removed in real time (existing functionality)

### Bonus work
- [x] Enhanced deep terrain generation (ore deposits, gold veins, larger caves at depth)
- [x] Expanded chunk loading range (5x6 grid, biased downward)
- [x] Improved tree placement (only on grass, better spacing)
- [x] Position correction triggers chunk loading

### Definition of Done
**Mine dirt, collect it, place it somewhere else. Build a house from materials you gathered. Inventory persists across sessions.** ✅

---

## Day 3: Portal System & Multi-World Architecture (IN PROGRESS)

**Goal:** Multiple worlds running as separate backends. Portals transport players between them.

### Shared Infrastructure

- [x] Create `Shared/worldConfig.js` — world configuration loader
- [x] Create world config JSON files (portals defined inline, no separate registry needed)
- [x] Add new tile type `PORTAL = 8` to `Shared/Utils/constants.js`
- [x] Add portal color to frontend `TILE_COLORS`: `8: 0x9C27B0` (purple)

### Backend

- [x] Accept `WORLD_CONFIG` env var (path to JSON file)
- [x] Load world config on startup — use its seed, gravity, name
- [x] On startup: place portal tiles at configured positions using `worldState.placeBlock()`
- [x] Portal detection function (`checkPortalCollision`):
  - [x] Check if player is on a `PORTAL` tile
  - [x] Generate a signed JWT containing: `{ username, inventory, credits, targetWorld }`
  - [x] Send `portalTransfer` message: `{ targetUrl, token, worldName }`
- [ ] **Wire up E-key `portalInteract` message to trigger portal transfer** (next session)
- [x] Accept incoming portal transfers (`portalArrive` handler)
  - [x] Validate JWT token
  - [x] Create player session from token data (username, inventory, credits)
  - [x] Spawn at target world's portal position
- [x] Add JWT dependency: `jsonwebtoken`
- [x] Shared `PORTAL_SECRET` env var across all world instances
- [x] World name included in welcome message payload

### Frontend

- [x] `handlePortalTransfer` method: fade to black, show travel text, disconnect, reconnect to new world
- [x] `checkPortalProximity` method: "Press E to enter portal" prompt when near portal
- [ ] **Debug E key → portalInteract → portalTransfer flow** (next session)
- [x] Portal tile renders as purple
- [x] Show current world name in HUD
- [x] Portal token sent via `portalArrive` on reconnect to new world
- [x] Portal fade removed on welcome

### Docker Compose

- [x] Update `docker-compose.yml` with multiple world backends (Origin, Caverns, Skylands)
- [x] Create `worlds/` directory with config JSON files:
  - [x] `origin.json` — seed 12345, standard gravity, 2 portals
  - [x] `caverns.json` — seed 99999, deeper caves, more stone, 1 portal
  - [x] `skylands.json` — seed 77777, higher terrain, low gravity (15), 1 portal
- [x] `start.sh` launcher script — auto-detects host IP, generates active compose file
- [x] Frontend connects to Origin by default, portals handle the rest
- [x] `.gitignore` updated to exclude generated `docker-compose.active.yml`

### Testing

- [x] Start all 3 worlds with `bash start.sh`
- [x] Connect to origin world → see purple portal blocks
- [ ] Walk to portal → press E → screen fades → appear in caverns with different terrain
- [ ] Inventory carries over through portal
- [ ] Walk into caverns' portal → return to origin
- [ ] Credits and inventory persist across world transfers
- [ ] Multiple players can use portals independently

### Definition of Done
**Walk into a portal in Origin, appear in Caverns with your inventory intact. Walk into another portal, arrive in Skylands. Three separate worlds, one identity.**

---

## Day 4: Economy & Trading

**Goal:** Credits system, AI shopkeeper, player-to-player trading.

### Backend

- [ ] Block value table in constants:
```javascript
  BLOCK_VALUES: { 1: 1, 2: 2, 3: 1, 5: 1, 6: 3, 7: 2 }
  // dirt=1, stone=2, grass=1, sand=1, wood=3, leaves=2
```
- [ ] Discovery bonus: first time a player enters a new chunk, award 5 credits
  - [ ] Track discovered chunks per player in DB: `discovered_chunks TEXT` (JSON array of chunk keys)
- [ ] New message handlers:
  - [ ] `shopBuy` — `{ item: "stone", quantity: 5 }` → deduct credits, add to inventory
  - [ ] `shopSell` — `{ item: "stone", quantity: 5 }` → remove from inventory, add credits
  - [ ] `tradeRequest` — `{ targetPlayerId }` → send trade invite to nearby player
  - [ ] `tradeOffer` — `{ items: [...], credits: 10 }` → propose trade terms
  - [ ] `tradeAccept` — execute the trade (swap items/credits atomically)
  - [ ] `tradeDecline` — cancel trade
- [ ] Trade validation:
  - [ ] Both players must be in same zone
  - [ ] Both players must be within 10 tiles of each other
  - [ ] Both players must have the items/credits they're offering
  - [ ] Atomic: both sides transfer or neither does
- [ ] Save credits to DB on change

### AI Agents — Shopkeeper

- [ ] Modify Forge agent personality to `shopkeeper`:
  - [ ] Stays within 5 tiles of spawn (doesn't wander far)
  - [ ] Responds to nearby chat messages containing "buy" or "sell"
  - [ ] Parse simple commands: "buy 10 stone", "sell 5 wood", "prices"
  - [ ] Send chat responses with prices and confirmations
  - [ ] Execute trades via the shop message handlers
- [ ] Shopkeeper announces presence periodically: "Forge's Shop is open! Say 'prices' to see what I have."
- [ ] **Rookery integration point:** Replace hardcoded chat parsing with LLM inference call for natural language understanding (optional, enhancement)

### Frontend

- [ ] Create `ShopUI` class:
  - [ ] Press E when near Forge → opens shop overlay
  - [ ] Grid showing available items, prices, buy/sell buttons
  - [ ] Quantity selector (1, 5, 10, all)
  - [ ] Current credits shown prominently
  - [ ] Close with Escape
- [ ] Create `TradeUI` class:
  - [ ] Press E when near another player → send trade request
  - [ ] Split panel: "Your Offer" | "Their Offer"
  - [ ] Click items from inventory to add to offer
  - [ ] Credits input field
  - [ ] Accept / Decline buttons
  - [ ] Both players see updates in real time
- [ ] Update HUD: show credits with a coin icon
- [ ] Chat integration: show shop responses inline in chat

### Testing

- [ ] Mine 20 stone → sell to Forge → credits increase by 40
- [ ] Buy 5 wood from Forge → credits decrease by 15, wood appears in inventory
- [ ] Try to buy with insufficient credits → error message
- [ ] Player A sends trade request to Player B → both see trade UI
- [ ] Complete a trade → items and credits swap correctly
- [ ] Decline a trade → nothing changes
- [ ] Credits persist across sessions and portal transfers
- [ ] Discovery bonus: walk into new chunks → credits tick up

### Definition of Done
**Mine stone, sell to Forge for credits, buy wood, build with it. Trade with another player — give them 5 stone for 10 credits. Economy persists everywhere.**

---

## Day 5: User-Generated Worlds & Polish

**Goal:** Anyone can create a world. World browser to discover and travel to worlds.

### Backend

- [ ] Create `Backend/Src/Api/worldApi.js` — REST endpoints on express:
  - [ ] `GET /api/worlds` — list all registered worlds with: name, description, seed, player count, creator, status (online/offline)
  - [ ] `POST /api/worlds` — create a new world: `{ name, seed, description, gravity }` → writes config JSON, registers in world directory DB
  - [ ] `GET /api/worlds/:id/status` — health check for a specific world
- [ ] World directory table in SQLite:
```
  worlds: id TEXT PRIMARY KEY, name TEXT, description TEXT, seed INTEGER,
          gravity REAL, creator TEXT, websocket_url TEXT,
          created_at TEXT, player_count INTEGER DEFAULT 0
```
- [ ] Update player count: each world backend reports its count to the DB every 30 seconds
- [ ] Auto-generate return portal in new worlds (links back to Origin)
- [ ] World creation spawns a new Docker container (stretch goal) OR pre-allocates a pool of world slots

### Frontend

- [ ] Create `WorldBrowser` class:
  - [ ] Press M to open world browser overlay
  - [ ] Grid/list of available worlds:
    - [ ] World name, description, player count, creator name
    - [ ] "Travel" button → initiates portal transfer to that world
  - [ ] "Create World" tab:
    - [ ] Name input (3-24 chars)
    - [ ] Seed input (number, or "Random" button)
    - [ ] Description textarea
    - [ ] Gravity slider (0.5x to 2x)
    - [ ] "Create" button → calls POST /api/worlds
  - [ ] Same visual style as auth screen (dark theme, cyan accents)
  - [ ] Close with Escape or M
- [ ] Add world name to HUD (show which world you're in)
- [ ] Update portal transfer to work from world browser (not just physical portals)

### Polish

- [ ] Loading screen between world transfers (progress bar or spinner)
- [ ] Fix any bugs accumulated over the week
- [ ] Sound effects (Web Audio API, no external files):
  - [ ] Jump: short upward tone
  - [ ] Place block: thud
  - [ ] Mine block: crack
  - [ ] Portal enter: whoosh
  - [ ] Chat received: soft ping
- [ ] Mobile/touch support:
  - [ ] Virtual joystick (left side of screen) for movement
  - [ ] Jump button (right side)
  - [ ] Tap to place/mine blocks
- [ ] Update `README.md` with:
  - [ ] Multi-world setup documentation
  - [ ] World creation guide
  - [ ] Economy overview
  - [ ] Portal system explanation
  - [ ] Updated architecture diagram
  - [ ] Screenshots

### Helm/K8s Prep (for post-MVP cluster deployment)

- [ ] Update Helm chart with multi-world support:
  - [ ] Each world = a StatefulSet with 1 replica
  - [ ] Shared PersistentVolumeClaim for SQLite
  - [ ] ConfigMap per world (seed, gravity, portals)
  - [ ] Service per world for WebSocket routing
  - [ ] Ingress rules to route by world ID
- [ ] Document Helm deployment for Raspberry Pi cluster
- [ ] Test on local kind/k3s cluster before deploying to hardware

### Testing

- [ ] Open world browser → see Origin, Caverns, Skylands
- [ ] Create a new world from the browser → it appears in the list
- [ ] Travel to the new world via browser → arrive with inventory
- [ ] Another player can see and travel to your world
- [ ] Sound effects play on actions
- [ ] Mobile: connect from phone, use touch controls to play
- [ ] Full loop: register → mine → sell → portal → buy → build → create world → invite friend

### Definition of Done
**Open world browser, see all worlds, create your own with a custom seed, share it with a friend, they portal in. The full OASIS loop.**

---

## Day 6: Visual Facelift — Tileset & Sprite System

**Goal:** Replace colored rectangles with pixel art tilesets and character sprites. Make it look like a real game.

### Tileset

- [ ] Source or create a 16x16 or 32x32 pixel art tileset (Terraria/Stardew style):
  - [ ] Dirt (with edge variants)
  - [ ] Stone (with edge variants)
  - [ ] Grass (top surface + sides)
  - [ ] Sand
  - [ ] Wood (trunk)
  - [ ] Leaves (canopy)
  - [ ] Water (animated or tinted)
  - [ ] Portal (animated glow)
- [ ] Pack tiles into a spritesheet (single PNG + JSON atlas)
- [ ] Add tileset to `Frontend/Public/Assets/`

### Terrain Rendering Upgrade

- [ ] Replace `fillRect` tile rendering with spritesheet-based rendering in `ChunkRenderer`:
  - [ ] Load tileset as Phaser spritesheet in `preload()`
  - [ ] Map tile type → sprite frame index
  - [ ] Auto-tiling: select correct frame based on neighboring tiles (e.g., grass only on top of dirt, stone edges)
  - [ ] Water tiles: apply alpha or tint for transparency effect
- [ ] Background parallax layer (sky gradient or distant mountains)
- [ ] Smooth chunk transitions (no visible seam between chunks)

### Character Sprites

- [ ] Create or source simple character spritesheet:
  - [ ] Idle frame (front-facing)
  - [ ] Walk left/right (2-4 frames)
  - [ ] Jump frame
  - [ ] Tinted by player color selection
- [ ] Replace player rectangles with animated sprites:
  - [ ] Idle animation when standing still
  - [ ] Walk animation when moving horizontally
  - [ ] Jump frame when airborne
  - [ ] Flip sprite based on direction
- [ ] Apply same sprite system to AI agent avatars

### UI Polish

- [ ] Hotbar styled with tileset icons instead of color swatches
- [ ] Chat box background polish (rounded corners, slight transparency)
- [ ] HUD background polish (match game aesthetic)
- [ ] Loading screen with Aetharia logo/art
- [ ] Particle effects: block break particles, landing dust

### Testing

- [ ] All tile types render with correct sprites
- [ ] Auto-tiling looks correct (grass on top of dirt, stone edges blend)
- [ ] Character walks with animation, jumps with jump frame
- [ ] AI agents use same sprite system
- [ ] Performance: no framerate drop from sprite rendering vs rectangles
- [ ] Tileset renders correctly across chunk boundaries

### Definition of Done
**The world looks like a pixel art game. Terrain has proper tiles with edge blending, players are animated sprites, and the UI feels polished and cohesive.**

---

## Post-MVP: The Road to the OASIS

After completing the 6-day plan, these are the next milestones:

- [ ] **Rookery LLM Integration** — AI agents powered by distributed inference across Pi cluster
- [ ] **3D Client** — Unity or Unreal client connecting to the same backend
- [ ] **VR Support** — SteamVR / Quest integration via the 3D client
- [ ] **Combat System** — PvP zones, weapons, health, respawning
- [ ] **Quest System** — AI agents that give quests, track progress, reward completion
- [ ] **Crafting** — Combine items to create new items (workbench, furnace)
- [ ] **Biomes** — Different terrain generators per world type (desert, ocean, forest, caves)
- [ ] **Friends & Guilds** — Social layer, friend list, guild worlds
- [ ] **Marketplace** — Cross-world item trading, auction house
- [ ] **Modding API** — Let world creators define custom blocks, mobs, physics rules

---

*"Going outside is highly overrated." — Ernest Cline, Ready Player One*
