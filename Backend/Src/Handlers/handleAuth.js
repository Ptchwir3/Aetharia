// Backend/Src/Handlers/handleAuth.js
//
// AETHARIA — Authentication Handler
// ================================
// Handles register and login messages.
// Returns player state on successful auth.

const bcrypt = require('bcryptjs');
const db = require('../Database/db');
const log = require('../Utils/logger');

const SALT_ROUNDS = 10;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,16}$/;

function handleRegister(data, ws) {
  const { username, password, color } = data;

  // Validate username
  if (!username || !USERNAME_REGEX.test(username)) {
    sendAuthError(ws, 'Username must be 3-16 characters (letters, numbers, underscore)');
    return null;
  }

  // Validate password
  if (!password || password.length < 4 || password.length > 64) {
    sendAuthError(ws, 'Password must be 4-64 characters');
    return null;
  }

  // Validate color
  const playerColor = (typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color))
    ? color : '#FF5722';

  // Hash password and create account
  const hash = bcrypt.hashSync(password, SALT_ROUNDS);
  const result = db.createPlayer(username, hash, playerColor);

  if (!result.success) {
    sendAuthError(ws, result.error);
    return null;
  }

  log(`📝 New account registered: ${username}`);

  // Return fresh player state
  return {
    username,
    color: playerColor,
    x: 0,
    y: 0,
    zone: 'zone_central',
    inventory: [
      { name: 'stone', tile: 2, quantity: 20 },
      { name: 'wood', tile: 6, quantity: 10 },
    ],
    credits: 100,
  };
}

function handleLogin(data, ws) {
  const { username, password } = data;

  if (!username || !password) {
    sendAuthError(ws, 'Username and password required');
    return null;
  }

  const player = db.getPlayer(username);
  if (!player) {
    sendAuthError(ws, 'Account not found');
    return null;
  }

  if (!bcrypt.compareSync(password, player.password_hash)) {
    sendAuthError(ws, 'Wrong password');
    return null;
  }

  log(`🔑 Player logged in: ${username}`);

  // Parse inventory from JSON
  let inventory = [];
  try {
    inventory = JSON.parse(player.inventory || '[]');
  } catch (e) {
    inventory = [];
  }

  return {
    username,
    color: player.color,
    x: player.x,
    y: player.y,
    zone: player.zone,
    inventory,
    credits: player.credits,
  };
}

function sendAuthError(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'authError', message }));
  }
}

module.exports = { handleRegister, handleLogin };
