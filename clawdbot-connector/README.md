# OpenClaw Connector

**Reusable backend for multi-user OpenClaw applications**

This directory contains the core backend components that enable any UI to connect to OpenClaw with real-time multi-user collaboration.

## Components

### 1. `sync-service.js` - The Room Server
WebSocket server that manages:
- **Chat** — Human-to-human messaging
- **Presence** — Who's online, where they are
- **Mention detection** — Detects AI mentions in regular chat and forwards to OpenClaw
- **Context building** — Sends last N messages as conversation context
- **State sync** — Broadcast changes (drawings, annotations, etc.)
- **History** — Recent chat for late joiners

### 2. `clawdbot-client.js` - AI Participant (Optional)
Connects an OpenClaw session to the room as an active participant. Use this if you want OpenClaw to:
- See ambient chat
- Announce proactively
- Respond automatically to mentions

**Not required** — The sync service can forward invocations directly to OpenClaw without this.

## Installation

```bash
npm install
```

## Usage

### Start Sync Service

```bash
npm start
```

**With custom config:**
```bash
SYNC_PORT=3738 \
OPENCLAW_API=http://localhost:18789 \
OPENCLAW_TOKEN=your-bearer-token \
WORKSPACE_PATH=./my-workspace \
AI_USER_ID=pauline \
npm start
```

### Connect OpenClaw Client (Optional)

```bash
node clawdbot-client.js
```

**Or run in background:**
```bash
cd /path/to/clawdbot-connector
node clawdbot-client.js > /tmp/clawdbot-client.log 2>&1 &
```

## Configuration

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNC_PORT` | `3738` | WebSocket server port |
| `OPENCLAW_API` | `http://localhost:18789` | OpenClaw Gateway URL |
| `OPENCLAW_TOKEN` | — | Bearer token for Gateway authentication |
| `AI_USER_ID` | `pauline` | AI participant name (configurable) |
| `AI_SESSION_USER` | — | OpenClaw session user |
| `CONTEXT_MESSAGES` | — | Number of recent messages to include as context |
| `WORKSPACE_PATH` | `./workspace` | File storage location |
| `LOG_CHAT` | `true` | Log chat to files |

## API

See [../docs/API.md](../docs/API.md) for the WebSocket protocol.

**Quick reference:**

### Client → Server

```javascript
// Authenticate
{ type: 'auth', userId: 'rob', userType: 'human' }

// Chat
{ type: 'chat', text: 'Hello everyone' }

// Chat with AI mention (detected automatically)
{ type: 'chat', text: '@pauline research this location' }

// Move location
{ type: 'move', location: { lat: 52.48, lon: -1.89, name: 'Birmingham' } }

// Update state
{ type: 'state_update', update: { key: 'value' } }

// Save drawing
{ type: 'drawing', drawing: { id: 'abc', type: 'polygon', geojson: {...} } }
```

### Server → Client

```javascript
// Initial state
{ type: 'state', data: { drawings: [], annotations: [] } }

// Chat history
{ type: 'history', messages: [...] }

// New chat
{ type: 'chat', from: 'sarah', text: 'Hello', timestamp: 1738222800 }

// AI response
{ type: 'ai_response', from: 'pauline', text: 'Found 3 results...', timestamp: 1738222805 }

// Presence update
{ type: 'presence', users: [{ userId: 'rob', location: {...}, status: 'online' }] }

// User joined
{ type: 'join', userId: 'sarah', userType: 'human' }

// User moved
{ type: 'move', userId: 'rob', location: {...} }

// Drawing added
{ type: 'drawing', drawing: {...} }

// State changed
{ type: 'state_update', update: {...} }
```

## File Structure

After running, workspace will contain:

```
workspace/
├── state.json              # Current room state
├── drawings/               # Saved drawings
│   ├── abc123.geojson
│   └── def456.geojson
└── chat-logs/              # Daily chat logs
    ├── 2026-01-30.jsonl
    └── ...
```

## Reusing in Your Project

**Option 1: Copy the entire directory**
```bash
cp -r clawdbot-connector /path/to/your-project/
cd /path/to/your-project/clawdbot-connector
npm install
npm start
```

**Option 2: Install as dependency** (if published to npm)
```bash
npm install field-room-connector
```

**Option 3: Git submodule**
```bash
git submodule add https://github.com/robannable/field-room.git
cd field-room/clawdbot-connector
npm install
npm start
```

Then build your UI to connect to `ws://localhost:3738`.

## Health Check

```bash
curl http://localhost:3738/health
```

Returns:
```json
{
  "status": "ok",
  "clients": 3,
  "workspace": "./workspace",
  "uptime": 123.45
}
```

## Security Notes

⚠️ **This is a development setup** — no authentication or encryption.

**For production:**
- Add token-based auth to WebSocket connection
- Use WSS (secure WebSocket)
- Add rate limiting
- Validate all user input
- Don't expose publicly without security layer

## License

MIT
