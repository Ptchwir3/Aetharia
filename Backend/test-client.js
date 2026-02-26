// Backend/test-client.js
// Smoke test for the Aetharia backend

const WebSocket = require('ws');

const URL = 'ws://localhost:8080';
let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}`);
    failed++;
  }
}

function waitForMessage(ws, filter, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for message'));
    }, timeoutMs);
    const handler = (raw) => {
      const msg = JSON.parse(raw);
      if (filter(msg)) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

async function runTests() {
  console.log('\n🧪 AETHARIA Backend Test Suite\n');
  console.log('═══════════════════════════════════════\n');

  // ── TEST 1: Player 1 connects ──
  console.log('📡 Test 1: Player 1 Connection');
  const ws1 = new WebSocket(URL);
  const welcome1 = await new Promise((resolve, reject) => {
    ws1.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'welcome') resolve(msg);
    });
    ws1.on('error', reject);
    setTimeout(() => reject(new Error('Timeout')), 5000);
  });

  const player1Id = welcome1.id;
  assert(welcome1.type === 'welcome', 'Received welcome message');
  assert(typeof welcome1.id === 'string' && welcome1.id.length > 0, 'Got valid player ID');
  assert(typeof welcome1.x === 'number', 'Got spawn X coordinate');
  assert(typeof welcome1.y === 'number', 'Got spawn Y coordinate');
  assert(typeof welcome1.zone === 'string', 'Got zone assignment');
  assert(welcome1.chunks && Object.keys(welcome1.chunks).length === 9, 'Got 3x3 initial chunks (9 total)');
  assert(welcome1.worldConfig && welcome1.worldConfig.chunkSize === 32, 'Got world config with chunk size');

  const firstChunkKey = Object.keys(welcome1.chunks)[0];
  const firstChunk = welcome1.chunks[firstChunkKey];
  assert(firstChunk.tiles && Array.isArray(firstChunk.tiles), 'Chunk has tiles array');
  assert(firstChunk.tiles.length === 32, 'Chunk is 32 tiles tall');
  assert(firstChunk.tiles[0].length === 32, 'Chunk is 32 tiles wide');
  console.log('');

  // ── TEST 2: Player 2 connects ──
  console.log('📡 Test 2: Player 2 Connection + Notifications');
  const joinPromise = waitForMessage(ws1, (m) => m.type === 'playerJoined');
  const ws2 = new WebSocket(URL);
  const welcome2 = await new Promise((resolve, reject) => {
    ws2.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'welcome') resolve(msg);
    });
    ws2.on('error', reject);
    setTimeout(() => reject(new Error('Timeout')), 5000);
  });

  const player2Id = welcome2.id;
  assert(welcome2.type === 'welcome', 'Player 2 got welcome');
  assert(welcome2.id !== player1Id, 'Player 2 has different ID');

  const existingPlayers = await waitForMessage(ws2, (m) => m.type === 'existingPlayers').catch(() => null);
  assert(existingPlayers && existingPlayers.players.length === 1, 'Player 2 received existing players list');

  const joinMsg = await joinPromise;
  assert(joinMsg.type === 'playerJoined' && joinMsg.id === player2Id, 'Player 1 notified of player 2 joining');
  console.log('');

  // ── TEST 3: Movement ──
  console.log('🚶 Test 3: Movement + Broadcasting');
  const movePromise = waitForMessage(ws1, (m) => m.type === 'playerMoved');
  ws2.send(JSON.stringify({ type: 'move', x: 5, y: 3 }));
  const moveMsg = await movePromise;
  assert(moveMsg.type === 'playerMoved', 'Player 1 received movement broadcast');
  assert(moveMsg.id === player2Id, 'Movement is from player 2');
  assert(moveMsg.x === 5 && moveMsg.y === 3, 'Correct coordinates received');
  console.log('');

  // ── TEST 4: Anti-cheat ──
  console.log('🛡️  Test 4: Anti-Cheat Validation');
  await new Promise((r) => setTimeout(r, 100));
  const errorPromise = waitForMessage(ws2, (m) => m.type === 'error');
  ws2.send(JSON.stringify({ type: 'move', x: 99999, y: 99999 }));
  const errorMsg = await errorPromise;
  assert(errorMsg.type === 'error', 'Server rejected suspicious move');
  assert(errorMsg.message.includes('Movement too large'), 'Got correct error message');
  console.log('');

  // ── TEST 5: Chat ──
  console.log('💬 Test 5: Chat Messaging');
  await new Promise((r) => setTimeout(r, 100));
  const chatPromise = waitForMessage(ws1, (m) => m.type === 'chatMessage');
  ws2.send(JSON.stringify({ type: 'chat', message: 'Hello Aetharia!' }));
  const chatMsg = await chatPromise;
  assert(chatMsg.type === 'chatMessage', 'Chat message received');
  assert(chatMsg.id === player2Id, 'Chat is from player 2');
  assert(chatMsg.message === 'Hello Aetharia!', 'Message content correct');
  assert(typeof chatMsg.timestamp === 'number', 'Chat has timestamp');
  console.log('');

  // ── TEST 6: Chunk request ──
  console.log('🗺️  Test 6: Chunk Request');
  await new Promise((r) => setTimeout(r, 100));
  const chunkPromise = waitForMessage(ws1, (m) => m.type === 'chunkData');
  ws1.send(JSON.stringify({ type: 'requestChunk', chunkX: 1, chunkY: 0 }));
  const chunkMsg = await chunkPromise;
  assert(chunkMsg.type === 'chunkData', 'Received chunk data');
  assert(chunkMsg.chunk.x === 1 && chunkMsg.chunk.y === 0, 'Correct chunk coordinates');
  assert(chunkMsg.chunk.tiles.length === 32, 'Chunk has correct dimensions');

  // Determinism check
  await new Promise((r) => setTimeout(r, 100));
  const chunk2Promise = waitForMessage(ws1, (m) => m.type === 'chunkData');
  ws1.send(JSON.stringify({ type: 'requestChunk', chunkX: 1, chunkY: 0 }));
  const chunk2Msg = await chunk2Promise;
  const tilesMatch = JSON.stringify(chunkMsg.chunk.tiles) === JSON.stringify(chunk2Msg.chunk.tiles);
  assert(tilesMatch, 'Deterministic: same chunk requested twice = identical terrain');
  console.log('');

  // ── TEST 7: Disconnect ──
  console.log('🚪 Test 7: Disconnect Broadcasting');
  const leavePromise = waitForMessage(ws1, (m) => m.type === 'playerLeft');
  ws2.close();
  const leaveMsg = await leavePromise;
  assert(leaveMsg.type === 'playerLeft', 'Player 1 received disconnect notification');
  assert(leaveMsg.id === player2Id, 'Disconnect is for player 2');
  console.log('');

  // ── RESULTS ──
  console.log('═══════════════════════════════════════');
  console.log(`\n🏁 Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);

  ws1.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('💥 Test suite crashed:', err.message);
  process.exit(1);
});
