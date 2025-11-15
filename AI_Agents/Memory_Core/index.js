// AI_Agents/memory-core/index.js

const memory = {};

function store(key, value) {
  memory[key] = value;
}

function recall(key) {
  return memory[key] || null;
}

module.exports = { store, recall };
