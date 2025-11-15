// Src/World/zoneManager.js

const zones = {};

function assignPlayerToZone(playerId) {
  // For now, assign everyone to Zone 1
  const zoneId = 'zone1';
  if (!zones[zoneId]) {
    zones[zoneId] = [];
  }
  zones[zoneId].push(playerId);

  console.log(`🧭 Player ${playerId} assigned to ${zoneId}`);
  return zoneId;
}

function getZonePlayers(zoneId) {
  return zones[zoneId] || [];
}

module.exports = {
  assignPlayerToZone,
  getZonePlayers,
};
