# Quick Start Guide

Get Field Room running in 5 minutes.

## Prerequisites

- **Node.js 18+** — `node --version`
- **OpenClaw** — `npm install -g openclaw`

## Step 1: Start OpenClaw Gateway

If not already running:

```bash
openclaw gateway start
```

Check status:
```bash
openclaw gateway status
```

Should see:
```
✓ Gateway running on http://localhost:18789
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
[Sync Service] Listening on 0.0.0.0:3738
[Sync Service] WebSocket: ws://localhost:3738
[Sync Service] Workspace: ./workspace
```

The sync service binds to `0.0.0.0` by default for LAN access.

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

### Invoke OpenClaw

In either window, type:

```
@pauline what's the weather like?
```

OpenClaw will respond in the chat ✓

(The AI user name defaults to "pauline" but is configurable via the `AI_USER_ID` env var.)

### Change Location

Type:
```
/move 52.486,-1.890
```

You'll see a system message about your location change.

---

## Common Issues

### "Connection failed"

**Check OpenClaw Gateway is running:**
```bash
curl http://localhost:18789/health
```

Should return JSON with `status: "ok"`.

If not, start it:
```bash
openclaw gateway start
```

---

### "OpenClaw not responding"

**Check sync service config:**
```bash
# In clawdbot-connector directory
OPENCLAW_API=http://localhost:18789 OPENCLAW_TOKEN=your-token npm start
```

**Test OpenClaw directly:**
```bash
curl -X POST http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"messages": [{"role": "user", "content": "hello"}]}'
```

Should return a response from OpenClaw.

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

### Connect OpenClaw as Participant

Make OpenClaw actively join the room:

```bash
cd clawdbot-connector
node clawdbot-client.js
```

Now OpenClaw sees all ambient chat and can announce proactively.

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

# OpenClaw Gateway URL
OPENCLAW_API=http://localhost:18789

# Bearer token for Gateway authentication
OPENCLAW_TOKEN=your-bearer-token

# Workspace directory
WORKSPACE_PATH=/path/to/workspace

# AI user ID (default: pauline)
AI_USER_ID=pauline

# OpenClaw session user
AI_SESSION_USER=field-room

# Number of recent messages for context
CONTEXT_MESSAGES=20

# Chat logging
LOG_CHAT=true
```

**Example:**
```bash
SYNC_PORT=3738 \
WORKSPACE_PATH=./my-workspace \
AI_USER_ID=pauline \
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
       │ HTTP (/v1/chat/completions)
       ▼
┌─────────────┐
│  OpenClaw   │
│   Gateway   │
│  (:18789)   │
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
