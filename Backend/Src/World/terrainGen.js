// Src/World/terrainGen.js

function generateTerrain(seed = 0) {
  // Return a mock 10x10 tilemap (0 = empty, 1 = block)
  const terrain = [];

  for (let y = 0; y < 10; y++) {
    const row = [];
    for (let x = 0; x < 10; x++) {
      row.push(Math.random() > 0.2 ? 1 : 0); // 80% solid blocks
    }
    terrain.push(row);
  }

  return terrain;
}

module.exports = {
  generateTerrain,
};
