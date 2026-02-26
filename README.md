# ⚔ AETHARIA ⚔

**An open-source, distributed metaverse you can run with a single command.**

Aetharia is a multiplayer 2D world with procedural terrain, server-side physics, AI agents that build autonomously, and an architecture designed to scale across Kubernetes clusters — from Raspberry Pis to cloud servers.

> *Inspired by Ready Player One's OASIS. Built for hackers, tinkerers, and dreamers.*

![Status](https://img.shields.io/badge/status-MVP-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue) ![Docker](https://img.shields.io/badge/docker-compose-2496ED)

---

## 🎮 What You Get

- **Procedural terrain** — Terraria-style world generated from a seed (same seed = same world everywhere)
- **Server-side gravity** — Physics run on the server, so all clients (humans and AI) play by the same rules
- **Multiplayer** — See other players in real time with custom names and colors
- **AI agents** — Three autonomous NPCs (Claude, Atlas, Forge) explore and build structures while you play
- **Real-time world modification** — AI agents place blocks and everyone sees the changes instantly
- **Zone architecture** — World is divided into zones, ready for horizontal scaling across cluster nodes
- **Profile picker** — Choose your name and color on connect
- **Chat system** — Zone-scoped chat (press T to talk)

---

## 🚀 Quick Start (Docker Compose)

```bash
git clone https://github.com/Ptchwri3/Aetharia.git
cd Aetharia
docker compose up --build
```

Open your browser to:

```
http://localhost:3500
```

That's it. You're in.

**Multiple players?** Open more browser tabs, or connect from other devices on your network:

```
http://<YOUR_IP>:3500/?server=<YOUR_IP>:8080
```

**To stop:**

```bash
docker compose down
```

**To rebuild after code changes:**

```bash
docker compose up --build
```

---

## 🏗 Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────────────────┐
│   Browser    │◄──────────────────►│     Backend (port 8080)      │
│   (Phaser)   │                    │                              │
│  port 3500   │                    │  • WebSocket game server     │
└─────────────┘                    │  • Server-side gravity       │
                                   │  • Zone management           │
┌─────────────┐     WebSocket      │  • Procedural terrain gen    │
│  AI Agents   │◄──────────────────►│  • World state persistence   │
│  (Node.js)   │                    │  • Anti-cheat validation     │
│  Claude      │                    └──────────────────────────────┘
│  Atlas       │
│  Forge       │
└─────────────┘
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| **backend** | 8080 | WebSocket game server — handles all game logic, physics, terrain, chat |
| **frontend** | 3500 | Phaser 3 browser client — renders world, handles input |
| **agents** | — | AI agents that connect as players, explore, and build structures |

---

## 📁 Repository Structure

```
Aetharia/
├── Backend/
│   └── Src/
│       ├── main.js              # Server entry — connections, physics loop, broadcasting
│       ├── Handlers/
│       │   └── handleMessage.js # Message routing — move, chat, blocks, profiles
│       ├── Player/
│       │   └── player.js        # Player factory with physics state
│       ├── World/
│       │   ├── terrainGen.js    # Seeded procedural terrain generation
│       │   ├── zoneManager.js   # Zone assignment and player tracking
│       │   └── worldState.js    # Block modification persistence
│       └── Utils/
│           ├── constants.js     # Path resolver for shared constants
│           └── logger.js        # Leveled logging
│
├── Frontend/
│   └── Public/
│       ├── index.html           # Game page with loading screen
│       └── Src/
│           └── main.js          # Phaser client — rendering, input, networking
│
├── AI_Agents/
│   ├── index.js                 # Agent spawner — connects 3 AI players
│   ├── Decision_Engine/
│   │   └── index.js             # Physics-aware building decisions
│   └── Memory_Core/
│       └── index.js             # World knowledge storage
│
├── Shared/
│   └── Utils/
│       └── constants.js         # Shared config (tiles, zones, physics, messages)
│
├── Helm/                        # Kubernetes Helm chart (ready for cluster deploy)
├── K8S/                         # Raw Kubernetes manifests
├── docker-compose.yml           # One-command full stack deployment
└── .dockerignore
```

---

## 🎮 Controls

| Key | Action |
|-----|--------|
| **A / ←** | Move left |
| **D / →** | Move right |
| **W / ↑ / Space** | Jump |
| **T** | Open chat |
| **Enter** | Send chat message |
| **Escape** | Close chat |

---

## 🤖 AI Agents

Three AI agents connect automatically and inhabit the world:

| Agent | Personality | Behavior |
|-------|-------------|----------|
| **Claude** | Architect | Plans and builds watchtowers, shelters |
| **Atlas** | Explorer | Traverses the world, requests new chunks |
| **Forge** | Builder | Constructs structures more frequently |

Agents are physics-aware — they build on solid ground, verify flat areas before construction, and their blocks must have structural support. They walk along the terrain surface just like human players.

**Future:** These agents are designed to be upgraded with LLM intelligence (local models via [Rookery](https://github.com/Ptchwri3/Rookery) or cloud APIs) for genuine reasoning, conversation, and creative building.

---

## ⚙️ Configuration

### Environment Variables (Backend)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | WebSocket server port |
| `AETHARIA_WORLD_SEED` | 12345 | World generation seed (same seed = same world) |
| `AETHARIA_HEARTBEAT` | 30000 | Heartbeat interval (ms) |
| `AETHARIA_DEBUG` | false | Enable debug logging |

### Environment Variables (Agents)

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_URL` | ws://localhost:8080 | Backend WebSocket URL |
| `AGENT_TICK_RATE` | 500 | Decision loop interval (ms) |

---

## 🛠 Local Development (No Docker)

### Backend

```bash
cd Backend
npm install
npm start
# Server running on ws://localhost:8080
```

### Frontend

```bash
cd Frontend
npm install
npx serve Public -l 3500
# Open http://localhost:3500/?server=localhost:8080
```

### AI Agents

```bash
cd AI_Agents
npm install
BACKEND_URL=ws://localhost:8080 npm start
```

---

## ☸️ Kubernetes Deployment (Helm)

Aetharia ships with a Helm chart for cluster deployment. The zone architecture maps naturally to Kubernetes pods — each zone can run on a separate node.

```bash
# Build and push images
docker build -t youruser/aetharia-backend:latest -f Backend/Dockerfile .
docker build -t youruser/aetharia-frontend:latest -f Frontend/Dockerfile .
docker build -t youruser/aetharia-agents:latest -f AI_Agents/Dockerfile .

docker push youruser/aetharia-backend:latest
docker push youruser/aetharia-frontend:latest
docker push youruser/aetharia-agents:latest

# Update Helm/values.yaml with your image repository

# Deploy
helm upgrade --install aetharia ./Helm \
  --namespace aetharia \
  --create-namespace

# Verify
kubectl get pods -n aetharia
kubectl get svc -n aetharia
```

---

## 🗺 Roadmap

- [x] Procedural terrain generation (seeded, deterministic)
- [x] Multiplayer WebSocket server with zone management
- [x] Server-side gravity and collision physics
- [x] AI agents that explore and build
- [x] Player profiles (name + color picker)
- [x] Real-time world modification (block place/remove)
- [x] Chat system (zone-scoped)
- [x] Docker Compose deployment
- [ ] LLM-powered AI agents (via Rookery distributed inference)
- [ ] Player block placement (click to build/mine)
- [ ] Sprite tilesets (replace colored rectangles with pixel art)
- [ ] Helm deployment across multi-node K8s cluster
- [ ] Day/night cycle
- [ ] Inventory system
- [ ] VR/3D client (Unity/Unreal)

---

## 🧱 Technical Details

### Terrain Generation
- Seeded PRNG (mulberry32) ensures deterministic generation
- Chunk-based: 32×32 tiles per chunk, generated on demand
- Terraria-style layers: air → grass → dirt → stone
- Surface noise with multiple octaves for natural hills
- Trees, caves, water, sand beaches

### Server-Side Physics
- 20 tick/sec physics loop applies gravity to all connected entities
- Collision detection against world tiles (solid vs air/water)
- Jump velocity, max fall speed, head bonk on ceilings
- Unstick logic prevents players from getting trapped in terrain
- Authoritative position — server corrects client positions

### Zone System
- World divided into 5 zones (central, north, south, east, west)
- Players assigned to zones based on tile position
- Zone-scoped broadcasting (players only receive updates from their zone)
- Designed for horizontal scaling: each zone → separate pod/node

### World State
- Modifications stored as overrides on procedural terrain
- Base terrain is never mutated — generated fresh from seed
- Block changes persist in memory (future: Redis/disk)
- All clients receive real-time block update broadcasts

---

## 👤 Maintainer

**Josh "Ptchwir3" Nelson**
Builder of decentralized systems, autonomous drones, and experimental metaverse architectures.

---

## 📄 License

MIT — do whatever you want with it.
