# Quick Start Guide

Get Field Room running in 5 minutes.

## Prerequisites

- **Node.js 18+** — `node --version`
- **Clawdbot** — `npm install -g clawdbot`

## Step 1: Start Clawdbot Gateway

If not already running:

```bash
clawdbot gateway start
```

Check status:
```bash
clawdbot gateway status
```

Should see:
```
✓ Gateway running on http://localhost:3737
```

## Step 2: Clone & Install

```bash
git clone https://github.com/robannable/field-room.git
cd field-room/clawdbot-connector
npm install
```

## Step 3: Start Sync Service

```bash
npm start
```

You should see:
```
[Sync Service] Listening on port 3738
[Sync Service] WebSocket: ws://localhost:3738
[Sync Service] Workspace: ./workspace
```

## Step 4: Open Client

Open `examples/field-mapping/client/index.html` in a browser:

```bash
# Option 1: Direct open
open examples/field-mapping/client/index.html

# Option 2: Serve with Python
cd examples/field-mapping/client
python3 -m http.server 8000
# Then open http://localhost:8000
```

## Step 5: Join the Room

1. Enter your name (e.g., "Rob")
2. Click "Join"

You're in! 🎉

## Step 6: Try It Out

### Chat with another user

Open the client in a second browser window:
- Window 1: Join as "Rob"
- Window 2: Join as "Sarah"

Type in Window 1: `Hello Sarah`  
See it appear in Window 2 ✓

### Invoke Clawdbot

In either window, type:

```
@trillian what's the weather like?
```

Clawdbot will respond in the chat ✓

### Change Location

Type:
```
/move 52.486,-1.890
```

You'll see a system message about your location change.

---

## Common Issues

### "Connection failed"

**Check Clawdbot Gateway is running:**
```bash
curl http://localhost:3737/health
```

Should return JSON with `status: "ok"`.

If not, start it:
```bash
clawdbot gateway start
```

---

### "Clawdbot not responding"

**Check sync service config:**
```bash
# In clawdbot-connector directory
CLAWDBOT_API=http://localhost:3737 npm start
```

**Test Clawdbot directly:**
```bash
curl -X POST http://localhost:3737/api/sessions/send \
  -H "Content-Type: application/json" \
  -d '{"sessionKey": "test", "message": "hello"}'
```

Should return a response from Clawdbot.

---

### "No chat appearing"

**Open browser console** (F12) and check for errors.

Common fix: Make sure you're using `http://` not `file://` protocol.

Serve with Python:
```bash
cd examples/field-mapping/client
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

---

## Next Steps

### Customize the UI

Edit `examples/field-mapping/client/index.html` and `client.js`.

The right panel is intentionally blank — build your:
- Map view (Leaflet.js)
- 3D scene (Three.js)
- Document browser
- Drawing tools

### Add Features

**Location tracking:**
```javascript
navigator.geolocation.getCurrentPosition((pos) => {
  ws.send(JSON.stringify({
    type: 'move',
    location: {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude
    }
  }));
});
```

**Drawing integration:**
```javascript
map.on('draw:created', (e) => {
  ws.send(JSON.stringify({
    type: 'drawing',
    drawing: {
      type: 'boundary',
      geojson: e.layer.toGeoJSON()
    }
  }));
});
```

**File uploads:**
```javascript
input.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  // Upload to server, then broadcast
  ws.send(JSON.stringify({
    type: 'state_update',
    update: {
      files: [...existingFiles, { name: file.name, url: '...' }]
    }
  }));
});
```

### Connect Clawdbot as Participant

Make Clawdbot actively join the room:

```bash
cd clawdbot-connector
node clawdbot-client.js
```

Now Clawdbot sees all ambient chat and can announce proactively.

### Build for Production

**Security checklist:**
- [ ] Add authentication (JWT tokens)
- [ ] Use WSS (secure WebSocket)
- [ ] Enable CORS restrictions
- [ ] Add rate limiting
- [ ] Validate all user input
- [ ] Use HTTPS for HTTP endpoints

**Deployment:**
- Run sync service on a server
- Use nginx for reverse proxy
- Set up SSL certificates
- Configure firewall rules

---

## Configuration

### Environment Variables

```bash
# Sync service port
SYNC_PORT=3738

# Clawdbot Gateway URL
CLAWDBOT_API=http://localhost:3737

# Workspace directory
WORKSPACE_PATH=/path/to/workspace

# AI user ID
AI_USER_ID=trillian

# Session key for Clawdbot
AI_SESSION_KEY=field-room

# Chat logging
LOG_CHAT=true
```

**Example:**
```bash
SYNC_PORT=3738 \
WORKSPACE_PATH=./my-workspace \
AI_USER_ID=my-ai \
npm start
```

---

## Architecture Overview

```
┌─────────────┐
│   Browser   │
│   Client    │
└──────┬──────┘
       │ WebSocket
       ▼
┌─────────────┐
│    Sync     │
│   Service   │
└──────┬──────┘
       │ HTTP
       ▼
┌─────────────┐
│  Clawdbot   │
│   Gateway   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Workspace  │
│    Files    │
└─────────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed design.

---

## Resources

- **API Reference:** [API.md](API.md)
- **Examples:** `examples/field-mapping/`
- **Connector Code:** `clawdbot-connector/`

---

## Getting Help

1. Check the [API Reference](API.md)
2. Look at example client code
3. Open GitHub issue: https://github.com/robannable/field-room/issues

---

**You're ready to build!** Start customizing the client and adding your own features. The backend is solid — focus on the UI.
