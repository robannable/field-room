#!/bin/bash
# Quick start script for Field Room

echo "🌍 Field Room - Starting..."
echo ""

# Configuration
OPENCLAW_API=${OPENCLAW_API:-"http://127.0.0.1:18789"}
OPENCLAW_TOKEN=${OPENCLAW_TOKEN:-""}
AI_USER_ID=${AI_USER_ID:-"pauline"}
SYNC_PORT=${SYNC_PORT:-3738}
CLIENT_PORT=${CLIENT_PORT:-8000}

# Check if OpenClaw Gateway is running
echo "Checking OpenClaw Gateway..."
if ! curl -s "$OPENCLAW_API/health" > /dev/null 2>&1; then
  echo "⚠️  OpenClaw Gateway not running at $OPENCLAW_API"
  echo "Start it with: openclaw gateway start"
  exit 1
fi
echo "✅ Gateway is running"

# Check if node_modules exists
if [ ! -d "clawdbot-connector/node_modules" ]; then
  echo "📦 Installing dependencies..."
  cd clawdbot-connector
  npm install
  cd ..
fi

# Start sync service
echo "🚀 Starting Sync Service..."
cd clawdbot-connector
OPENCLAW_API="$OPENCLAW_API" \
OPENCLAW_TOKEN="$OPENCLAW_TOKEN" \
AI_USER_ID="$AI_USER_ID" \
SYNC_PORT="$SYNC_PORT" \
npm start &
SYNC_PID=$!
cd ..

sleep 2

# Start static file server for web client
echo "🌐 Starting web client server..."
cd examples/field-mapping/client
python3 -m http.server "$CLIENT_PORT" --bind 0.0.0.0 &
CLIENT_PID=$!
cd ../../..

# Get LAN IP
LAN_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "✅ Field Room is running!"
echo ""
echo "📍 Sync Service:  ws://${LAN_IP}:${SYNC_PORT}"
echo "🌐 Web Client:    http://${LAN_IP}:${CLIENT_PORT}"
echo "❤️  Health:        http://${LAN_IP}:${SYNC_PORT}/health"
echo "🤖 AI:            ${AI_USER_ID} via ${OPENCLAW_API}"
echo ""
echo "Press Ctrl+C to stop"

trap "echo ''; echo 'Stopping...'; kill $SYNC_PID $CLIENT_PID 2>/dev/null; exit" INT
wait $SYNC_PID
