// backend/src/handlers/handleMessage.js

module.exports = function handleMessage(data, playerId, players, ws, wss) {
  switch (data.type) {
    case 'move':
      players[playerId].x = data.x;
      players[playerId].y = data.y;

      // Broadcast new position to all other players
      const update = JSON.stringify({
        type: 'playerMoved',
        id: playerId,
        x: data.x,
        y: data.y
      });

      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === 1) {
          client.send(update);
        }
      });
      break;

    default:
      console.log(`⚠️ Unknown message type: ${data.type}`);
  }
};
