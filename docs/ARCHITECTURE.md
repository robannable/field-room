# Architecture

How Field Room enables multi-user collaboration with OpenClaw.

## Design Philosophy

**Problem:** Traditional chatbots are one-to-one. You send a command, get a response. No shared context, no collaboration, no presence.

**Solution:** Create a **persistent shared room** where:
- Humans chat directly (peer-to-peer, instant)
- AI is a participant (sees context, responds when invoked)
- State is synchronized (drawings, locations, documents)
- Presence is constant (who's here, what they're doing)

**Inspired by:**
- **Field Mapping** — Text-first collaborative site intelligence
- **On-Together** — Virtual coworking spaces
- **MUD interfaces** — Persistent shared worlds

---

## System Components

### 1. Sync Service (Room Server)

**Location:** `clawdbot-connector/sync-service.js`

**Responsibilities:**
- Accept WebSocket connections from clients
- Authenticate users
- Broadcast messages to all participants
- Detect @mentions and route to OpenClaw Gateway
- Build conversation context for AI requests
- Persist state to files
- Track presence (who's online, where they are)

**Key insight:** This is **not** a traditional chatbot backend. It's a **room** that both humans and AI inhabit.

**Technology:** Node.js + `ws` (WebSocket library)

---

### 2. OpenClaw Gateway

**Location:** External (OpenClaw installation)

**Responsibilities:**
- Serve `/v1/chat/completions` API (OpenAI-compatible)
- Manage AI sessions
- Execute tools (web search, file ops, etc.)
- Store memory (MEMORY.md, daily logs)

**Key insight:** The Gateway doesn't know about the room. The sync service translates invocations into chat completion requests, sending recent conversation as context.

**Integration:** The sync service calls `POST /v1/chat/completions` with Bearer token authentication. The `user` field is set to a stable session identifier so repeated calls share context within the Gateway.

**Technology:** OpenClaw agent framework (port 18789)

---

### 3. Workspace (File Storage)

**Location:** `workspace/` directory

**Contents:**
```
workspace/
├── state.json              # Current room state
├── drawings/               # GeoJSON drawings
│   └── *.geojson
├── chat-logs/              # Daily chat logs
│   └── YYYY-MM-DD.jsonl
└── [other project files]
```

**Key insight:** File-based persistence is:
- **Git-friendly** — Version control everything
- **Inspectable** — Open state.json in editor
- **Portable** — Copy workspace = copy project
- **OpenClaw-native** — Matches how OpenClaw works

---

### 4. Client UI

**Location:** `examples/field-mapping/client/`

**Responsibilities:**
- Connect to sync service via WebSocket
- Render chat, presence, typing indicators
- Send user input (chat, commands, drawings)
- Display AI responses

**Key insight:** The UI is **decoupled**. You can build:
- Web app (React, Vue, Svelte)
- Desktop app (Electron)
- Mobile app (React Native)
- Terminal UI (ncurses)

All using the same backend.

---

## Data Flow

### Human Chat (Direct)

```
User A                    Sync Service                 User B
  │                            │                          │
  ├─ chat: "Hello" ────────────>                          │
  │                            ├─ broadcast ──────────────>
  │                            │                          │
```

**No AI involved.** Instant peer-to-peer via WebSocket broadcast.

---

### AI Invocation (via Mention)

```
User A              Sync Service           OpenClaw Gateway     User B
  │                      │                       │                │
  ├─ chat ──────────────>                        │                │
  │  "@pauline ..."      │                       │                │
  │                      ├─ detect mention        │                │
  │                      ├─ build context         │                │
  │                      ├─ POST /v1/chat/ ──────>                │
  │                      │   completions          │                │
  │                      <────────────────────────┤                │
  │                      │   { response }         │                │
  │                      ├─ broadcast ────────────────────────────>
  │                      │   ai_response          │                │
  <──────────────────────┤                        │                │
```

**Flow:**
1. User sends a chat message mentioning the AI
2. Sync service detects the mention (regex on AI name)
3. Builds an OpenAI-compatible messages array from recent chat history
4. Sends to Gateway's `/v1/chat/completions` with Bearer auth
5. Broadcasts the response to all users as `ai_response`

**Key insight:** Everyone sees the AI's response, not just the requester. The AI gets conversation context, not just the single message.

---

### State Update (Drawings, Annotations, etc.)

```
User A              Sync Service           Workspace         User B
  │                      │                    │                │
  ├─ drawing ──────────>                      │                │
  │                      ├─ save ────────────>                │
  │                      │   drawings/*.json  │                │
  │                      ├─ broadcast ────────────────────────>
  │                      │                    │                │
```

**Persisted immediately** — Files written, then broadcast.

---

## Presence System

Sync service tracks:

```javascript
{
  userId: 'rob',
  userType: 'human',
  location: { lat: 52.48, lon: -1.89, name: 'Birmingham' },
  status: 'online',
  lastSeen: 1738222800000
}
```

**Broadcast on:**
- User joins/leaves
- User moves location

---

## Message Types

See [API.md](API.md) for full protocol.

**Core types:**
- `auth` — Join room
- `chat` — Human-to-human message (also triggers AI if mentioned)
- `invoke` — Explicit request to AI
- `ai_response` — Response from AI
- `typing` — AI is processing
- `move` — Location update
- `drawing` — Save/update drawing
- `state_update` — Arbitrary state change
- `presence` — Online users list

---

## AI Context System

When the AI is mentioned, the sync service builds a messages array:

1. **System message** — Sets AI identity and room context
2. **Recent chat** — Last N messages (configurable via `CONTEXT_MESSAGES`)
   - Human messages → `role: "user"` with `"username: text"` format
   - AI messages → `role: "assistant"`
3. **Current message** — The triggering mention

This gives the AI conversational awareness — it can follow threads, reference earlier messages, and respond contextually.

---

## File Structure

```
field-room/
├── clawdbot-connector/        # Reusable backend
│   ├── sync-service.js        # WebSocket room server + AI routing
│   ├── clawdbot-client.js     # AI participant connector (optional)
│   ├── package.json
│   └── README.md
│
├── examples/
│   └── field-mapping/         # Example implementation
│       └── client/            # Web UI
│           ├── index.html
│           └── client.js
│
├── docs/
│   ├── QUICKSTART.md
│   ├── API.md
│   ├── ARCHITECTURE.md        # This file
│   ├── LAN-TESTING.md
│   └── VPS-DEPLOYMENT.md
│
├── .env.example               # Configuration template
└── README.md
```

**Key separation:**
- **Connector** = reusable, UI-agnostic
- **Examples** = specific implementations
- **Docs** = how to use it

---

## Multi-User Patterns

### Pattern 1: Co-located Team

```
Rob: I'm at the north entrance
Sarah: I see you! Look at this drainage issue
@pauline what's the flood risk here?
Pauline: Flood Zone 2, medium risk...
```

### Pattern 2: Distributed Team

```
Rob (London): @pauline research Birmingham planning apps
Pauline: Found 12 applications...
Sarah (Birmingham): I can verify those on-site
```

### Pattern 3: Human + AI Pair

```
Rob: @pauline I'm surveying this site, what should I look for?
Pauline: Check for: 1) Boundary markers, 2) Access routes, 3) ...
Rob: Found the markers, adding photos
```

---

## Scalability Considerations

### Current Design (Simple)

- **WebSocket broadcast** — All messages to all clients
- **File-based state** — JSON files on disk
- **Single sync service** — One Node.js process

**Supports:** ~10-50 concurrent users comfortably

### Future Scaling

1. **Room sharding** — Separate rooms per project/site
2. **Redis pub/sub** — Multi-instance sync services
3. **Database** — PostgreSQL for state (optional)
4. **CDN** — Serve static assets
5. **Load balancer** — Multiple sync service instances

---

## Security Model

### Current (Development)

⚠️ **No client authentication or encryption**

- Any client can connect to the sync service
- Any user ID can be claimed
- WebSocket is unencrypted
- No rate limiting

**The sync service authenticates to OpenClaw Gateway** via Bearer token. Gateway credentials are not exposed to clients.

**Acceptable for:** Local network, trusted users, prototyping

### Production Hardening

See [VPS-DEPLOYMENT.md](VPS-DEPLOYMENT.md) for:
- Token-based client auth
- WSS (WebSocket Secure) via nginx
- Firewall rules
- Rate limiting
- Input validation

---

## OpenClaw Integration Details

### Session Routing

The sync service uses the `user` field in chat completion requests to maintain a stable session:

```javascript
{
  model: 'openclaw:main',
  user: 'field-room',  // Stable session key
  messages: [...]
}
```

This means repeated calls share context within the Gateway — the AI remembers the conversation across invocations.

### Conversation Context

The sync service sends the last N messages (default 10) as context. This means:
- AI can follow multi-turn conversations
- AI sees what other humans said
- AI sees its own previous responses

**Tradeoff:** More context = better responses but higher token usage.

---

## Design Principles

1. **UI-agnostic backend** — Connector works with any interface
2. **File-first persistence** — Inspectable, versionable, portable
3. **Ambient AI** — Not command-response, but participant
4. **Real-time sync** — Human chat is instant
5. **Simple to start** — npm install && npm start
6. **Production-ready path** — Can scale with proper infra

---

## Summary

Field Room creates a **shared workspace** where humans and AI collaborate naturally. The sync service is the room, OpenClaw is the intelligence, and clients are windows into that space.

**Core innovation:** Treating AI as an ambient participant in a persistent multi-user environment, not a request-response service.
