#!/bin/bash
# Aetharia Multi-World Launcher
# Replaces HOSTIP in docker-compose.yml with actual host IP

HOST_IP=$(hostname -I | awk '{print $1}')
echo "🌍 Starting Aetharia Multi-World on ${HOST_IP}"

# Export for docker compose env substitution
export HOSTIP="${HOST_IP}"

# Replace HOSTIP in the compose file temporarily
sed "s/HOSTIP/${HOST_IP}/g" docker-compose.yml > docker-compose.active.yml

docker compose -f docker-compose.active.yml up --build -d

echo ""
echo "🌍 Origin:   ws://${HOST_IP}:8080"
echo "🏔️  Caverns:  ws://${HOST_IP}:8081"
echo "☁️  Skylands: ws://${HOST_IP}:8082"
echo "🖥️  Frontend: http://${HOST_IP}:3500"
echo ""
echo "Open http://${HOST_IP}:3500 to play!"
