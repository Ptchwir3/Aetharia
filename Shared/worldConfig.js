// Shared/worldConfig.js
// Loads world configuration from JSON file or env var

const fs = require('fs');
const path = require('path');

function loadWorldConfig() {
  const configPath = process.env.WORLD_CONFIG;

  if (!configPath) {
    // Default: single-world mode (backward compatible)
    return {
      id: 'origin',
      name: 'Origin',
      seed: parseInt(process.env.AETHARIA_WORLD_SEED, 10) || 12345,
      gravity: 30,
      spawnX: 0,
      spawnY: 0,
      description: 'The starting world',
      portals: [],
    };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    console.log(`🌍 Loaded world config: ${config.name} (${config.id})`);
    return config;
  } catch (err) {
    console.error(`❌ Failed to load world config from ${configPath}:`, err.message);
    process.exit(1);
  }
}

module.exports = { loadWorldConfig };
