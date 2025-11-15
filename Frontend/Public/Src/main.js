// Frontend/Src/main.js

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#2d2d2d', // Helps confirm canvas renders
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false,
    },
  },
  scene: {
    preload,
    create,
    update
  }
};

let player;
let cursors;
let socket;

function preload() {
  console.log("🧠 Preloading assets...");
  this.load.image('player', '/Assets/player.png'); // Make sure player.png is in Public/Assets/
}

function create() {
  console.log("🚀 Creating scene...");

  // Load sprite
  try {
    player = this.physics.add.sprite(400, 300, 'player').setScale(1.5);
  } catch (err) {
    console.warn("⚠️ Failed to load sprite, using fallback box.");
    this.add.rectangle(400, 300, 100, 100, 0xff0000); // red box fallback
  }

  cursors = this.input.keyboard.createCursorKeys();

  // Connect to backend WebSocket
  console.log("🔌 Connecting to WebSocket...");
  socket = new WebSocket('ws://192.168.1.68:8080'); // Change this Address for the user that downloads the repo

  socket.onopen = () => {
    console.log("✅ WebSocket connected.");
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    console.log("📨 Incoming message:", msg);

    if (msg.type === 'welcome') {
      console.log(`🎉 Connected as ${msg.id}`);
    }
  };

  socket.onerror = (err) => {
    console.error("❌ WebSocket error:", err);
  };
}

function update() {
  console.log("🌀 Update loop running");

  if (!player || !cursors) return;

  player.setVelocity(0);

  if (cursors.left.isDown) player.setVelocityX(-200);
  if (cursors.right.isDown) player.setVelocityX(200);
  if (cursors.up.isDown) player.setVelocityY(-200);
  if (cursors.down.isDown) player.setVelocityY(200);

  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({
      type: 'move',
      x: player.x,
      y: player.y
    }));
  }
}

new Phaser.Game(config);
