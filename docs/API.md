# API Reference

WebSocket protocol for Field Room sync service.

## Connection

**Endpoint:** `ws://localhost:3738`

Connect using any WebSocket client:

```javascript
const ws = new WebSocket('ws://localhost:3738');
```

## Message Format

All messages are JSON:

```javascript
{
  "type": "message_type",
  // ... message-specific fields
}
```

## Client → Server Messages

### Auth

Authenticate when connection opens:

```javascript
{
  "type": "auth",
  "userId": "rob",           // Required: unique user ID
  "userType": "human",       // Optional: "human" | "ai" (default: "human")
  "metadata": {              // Optional: additional data
    "sessionKey": "...",
    "capabilities": [...]
  }
}
```

**Response:** Server sends `state` and `history` messages.

---

### Chat

Send a message to all users:

```javascript
{
  "type": "chat",
  "text": "Hello everyone"   // Required: message text
}
```

**Broadcast:** All clients receive the message with:
```javascript
{
  "type": "chat",
  "id": "abc123",
  "from": "rob",
  "text": "Hello everyone",
  "timestamp": 1738222800000
}
```

---

### Invoke

Send a command to Clawdbot:

```javascript
{
  "type": "invoke",
  "command": "@trillian research planning constraints",
  "id": "xyz789"             // Optional: for tracking responses
}
```

**Broadcast:** All clients receive Clawdbot's response:
```javascript
{
  "type": "clawdbot",
  "id": "response123",
  "from": "trillian",
  "text": "Found 3 planning applications...",
  "inReplyTo": "xyz789",     // If request had an ID
  "timestamp": 1738222805000
}
```

---

### Move

Update your location:

```javascript
{
  "type": "move",
  "location": {
    "lat": 52.486243,
    "lon": -1.890401,
    "name": "Birmingham City Centre"  // Optional
  }
}
```

**Broadcast:** Other clients receive:
```javascript
{
  "type": "move",
  "userId": "rob",
  "location": { ... },
  "timestamp": 1738222800000
}
```

---

### State Update

Update shared workspace state:

```javascript
{
  "type": "state_update",
  "update": {
    "currentProject": "Site A",
    "activeLayer": "boundaries"
  }
}
```

**Broadcast:** Other clients receive the same message.

**Persisted:** Merged into `workspace/state.json`.

---

### Drawing

Save a drawing (polygon, line, point):

```javascript
{
  "type": "drawing",
  "drawing": {
    "id": "abc123",          // Optional: auto-generated if not provided
    "name": "Site boundary",
    "description": "...",
    "type": "boundary",      // boundary | zone | route | marker
    "geojson": {             // Required: GeoJSON Feature
      "type": "Feature",
      "geometry": { ... },
      "properties": { ... }
    },
    "style": {               // Optional: visual style
      "color": "#3b82f6",
      "weight": 3,
      "opacity": 0.8
    }
  }
}
```

**Broadcast:** All clients receive:
```javascript
{
  "type": "drawing",
  "drawing": {
    "id": "abc123",
    "createdBy": "rob",
    "createdAt": 1738222800000,
    "updatedAt": 1738222800000,
    ...
  },
  "timestamp": 1738222800000
}
```

**Persisted:** Saved to `workspace/drawings/{id}.geojson`.

---

### Ping

Health check:

```javascript
{
  "type": "ping"
}
```

**Response:**
```javascript
{
  "type": "pong",
  "timestamp": 1738222800000
}
```

---

## Server → Client Messages

### State

Initial workspace state (sent after auth):

```javascript
{
  "type": "state",
  "data": {
    "drawings": [...],
    "annotations": [...],
    "users": [...]
  }
}
```

---

### History

Recent chat messages (sent after auth):

```javascript
{
  "type": "history",
  "messages": [
    { "type": "chat", "from": "sarah", "text": "...", "timestamp": ... },
    { "type": "clawdbot", "from": "trillian", "text": "...", "timestamp": ... }
  ]
}
```

---

### Chat

User message:

```javascript
{
  "type": "chat",
  "id": "abc123",
  "from": "sarah",
  "text": "Check out this site",
  "timestamp": 1738222800000
}
```

---

### Clawdbot

AI response:

```javascript
{
  "type": "clawdbot",
  "id": "def456",
  "from": "trillian",
  "text": "Found 3 planning applications within 500m...",
  "inReplyTo": "abc123",     // Optional: ID of original invoke
  "timestamp": 1738222805000
}
```

---

### Presence

List of online users (sent periodically or on change):

```javascript
{
  "type": "presence",
  "users": [
    {
      "userId": "rob",
      "userType": "human",
      "location": { "lat": 52.48, "lon": -1.89, "name": "Birmingham" },
      "status": "online",
      "lastSeen": 1738222800000
    },
    {
      "userId": "trillian",
      "userType": "ai",
      "location": null,
      "status": "online",
      "lastSeen": 1738222800000
    }
  ]
}
```

---

### Join

User joined the room:

```javascript
{
  "type": "join",
  "userId": "sarah",
  "userType": "human",
  "timestamp": 1738222800000
}
```

---

### Move

User changed location:

```javascript
{
  "type": "move",
  "userId": "rob",
  "location": {
    "lat": 52.486243,
    "lon": -1.890401,
    "name": "Birmingham City Centre"
  },
  "timestamp": 1738222800000
}
```

---

### Drawing

New or updated drawing:

```javascript
{
  "type": "drawing",
  "drawing": {
    "id": "abc123",
    "name": "Site boundary",
    "type": "boundary",
    "geojson": { ... },
    "style": { ... },
    "createdBy": "rob",
    "createdAt": 1738222800000,
    "updatedAt": 1738222800000
  },
  "timestamp": 1738222800000
}
```

---

### State Update

Workspace state changed:

```javascript
{
  "type": "state_update",
  "update": {
    "currentProject": "Site A",
    "activeLayer": "boundaries"
  },
  "timestamp": 1738222800000
}
```

---

### Typing

User is typing (optional feature):

```javascript
{
  "type": "typing",
  "userId": "trillian",
  "timestamp": 1738222800000
}
```

---

### Error

Error occurred:

```javascript
{
  "type": "error",
  "error": "Failed to invoke Clawdbot: timeout",
  "timestamp": 1738222800000
}
```

---

## HTTP Endpoints

### GET /health

Health check:

```bash
curl http://localhost:3738/health
```

**Response:**
```json
{
  "status": "ok",
  "clients": 3,
  "workspace": "/path/to/workspace",
  "uptime": 123.45
}
```

### GET /state

Get current workspace state:

```bash
curl http://localhost:3738/state
```

**Response:**
```json
{
  "drawings": [...],
  "annotations": [...],
  "users": [...]
}
```

---

## Example Client

### Minimal JavaScript Client

```javascript
const ws = new WebSocket('ws://localhost:3738');

ws.onopen = () => {
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth',
    userId: 'rob'
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type === 'chat') {
    console.log(`${msg.from}: ${msg.text}`);
  } else if (msg.type === 'clawdbot') {
    console.log(`AI: ${msg.text}`);
  }
};

// Send chat
function chat(text) {
  ws.send(JSON.stringify({ type: 'chat', text }));
}

// Invoke AI
function invoke(command) {
  ws.send(JSON.stringify({ type: 'invoke', command }));
}
```

---

## Clawdbot Integration

The sync service forwards invocations to Clawdbot via HTTP:

**Endpoint:** `POST http://localhost:3737/api/sessions/send`

**Request:**
```json
{
  "sessionKey": "field-room",
  "message": "@trillian research planning constraints"
}
```

**Response:**
```json
{
  "response": "Found 3 planning applications within 500m..."
}
```

The sync service then broadcasts this response to all clients as a `clawdbot` message.

---

## Security

⚠️ **No authentication or encryption in current version**

For production:
- Add JWT or token-based auth
- Use WSS (WebSocket Secure)
- Validate all input
- Rate limit requests
- Add CORS restrictions

---

## Rate Limiting

Not implemented in base version. Add using middleware like:

```javascript
const rateLimit = require('express-rate-limit');
```

---

## Error Handling

Clients should handle:
- Connection failures (auto-reconnect)
- Invalid JSON (parse errors)
- Unknown message types (ignore gracefully)
- Timeout on invocations

Example reconnect logic:

```javascript
ws.onclose = () => {
  setTimeout(() => connect(), 3000); // Reconnect after 3s
};
```
