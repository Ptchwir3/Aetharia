// Backend/Src/Database/db.js
//
// AETHARIA — SQLite Database
// ================================
// Persistent storage for player accounts, inventory, and credits.
// Uses better-sqlite3 for synchronous, fast access.

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'aetharia.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read/write performance
db.pragma('journal_mode = WAL');

// ─────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    color TEXT DEFAULT '#FF5722',
    x REAL DEFAULT 0,
    y REAL DEFAULT 0,
    zone TEXT DEFAULT 'zone_central',
    inventory TEXT DEFAULT '[]',
    credits INTEGER DEFAULT 100,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT DEFAULT (datetime('now'))
  );
`);

// ─────────────────────────────────────────────
// Prepared Statements
// ─────────────────────────────────────────────

const stmts = {
  createPlayer: db.prepare(`
    INSERT INTO players (username, password_hash, color)
    VALUES (?, ?, ?)
  `),

  getPlayer: db.prepare(`
    SELECT * FROM players WHERE username = ?
  `),

  saveState: db.prepare(`
    UPDATE players SET x = ?, y = ?, zone = ?, inventory = ?, credits = ?, last_login = datetime('now')
    WHERE username = ?
  `),

  updateColor: db.prepare(`
    UPDATE players SET color = ? WHERE username = ?
  `),
};

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

function createPlayer(username, passwordHash, color) {
  try {
    stmts.createPlayer.run(username, passwordHash, color);
    return { success: true };
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, error: 'Username already taken' };
    }
    throw e;
  }
}

function getPlayer(username) {
  return stmts.getPlayer.get(username) || null;
}

function savePlayerState(username, x, y, zone, inventory, credits) {
  const inventoryJson = typeof inventory === 'string' ? inventory : JSON.stringify(inventory);
  stmts.saveState.run(x, y, zone, inventoryJson, credits, username);
}

function updateColor(username, color) {
  stmts.updateColor.run(color, username);
}

module.exports = {
  db,
  createPlayer,
  getPlayer,
  savePlayerState,
  updateColor,
};
