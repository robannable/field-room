#!/bin/bash
# Quick start script for Field Room

echo "🌍 Field Room - Starting..."
echo ""

# Check if Clawdbot Gateway is running
echo "Checking Clawdbot Gateway..."
if ! curl -s http://localhost:3737/health > /dev/null 2>&1; then
  echo "⚠️  Clawdbot Gateway not running"
  echo "Starting Clawdbot Gateway..."
  clawdbot gateway start
  sleep 2
fi

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
npm start &
SYNC_PID=$!

# Wait for sync service to start
sleep 2

echo ""
echo "✅ Field Room is running!"
echo ""
echo "📍 Sync Service:  http://localhost:3738/health"
echo "🌐 Example Client: file://$(pwd)/../examples/field-mapping/client/index.html"
echo ""
echo "Or serve with Python:"
echo "  cd examples/field-mapping/client"
echo "  python3 -m http.server 8000"
echo "  Open http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Wait for interrupt
trap "echo ''; echo 'Stopping...'; kill $SYNC_PID; exit" INT
wait $SYNC_PID
