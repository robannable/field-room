# Architecture

How Field Room enables multi-user collaboration with Clawdbot.

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
- Forward invocations to Clawdbot
- Persist state to files
- Track presence (who's online, where they are)

**Key insight:** This is **not** a traditional chatbot backend. It's a **room** that both humans and AI inhabit.

**Technology:** Node.js + `ws` (WebSocket library)

---

### 2. Clawdbot Gateway

**Location:** External (Clawdbot installation)

**Responsibilities:**
- Manage AI sessions
- Execute tools (web search, file ops, etc.)
- Store memory (MEMORY.md, daily logs)
- Provide HTTP API for sending messages

**Key insight:** Clawdbot doesn't know about the room. The sync service translates invocations into session messages.

**Technology:** Clawdbot agent framework

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
- **Clawdbot-native** — Matches how Clawdbot works

---

### 4. Client UI

**Location:** `examples/field-mapping/client/`

**Responsibilities:**
- Connect to sync service via WebSocket
- Render chat, presence, drawings
- Send user input (chat, commands, drawings)
- Display Clawdbot responses

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

### Invoke Clawdbot

```
User A              Sync Service           Clawdbot          User B
  │                      │                    │                │
  ├─ invoke ───────────>                      │                │
  │  "@trillian ..."     ├─ HTTP POST ───────>                │
  │                      │   /sessions/send   │                │
  │                      <─────────────────────┤                │
  │                      │   { response }     │                │
  │                      ├─ broadcast ────────────────────────>
  │                      │   clawdbot msg     │                │
  <──────────────────────┤                    │                │
```

**Flow:**
1. User sends invoke message
2. Sync service forwards to Clawdbot Gateway HTTP API
3. Clawdbot processes (may use tools, search, etc.)
4. Response comes back to sync service
5. Sync service broadcasts to all users

**Key insight:** Everyone sees Clawdbot's response, not just the requester.

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
- Periodic heartbeat

**Displayed in UI** — "Who's online, where are they?"

---

## Message Types

See [API.md](API.md) for full protocol.

**Core types:**
- `auth` — Join room
- `chat` — Human-to-human message
- `invoke` — Request to Clawdbot
- `clawdbot` — Response from AI
- `move` — Location update
- `drawing` — Save/update drawing
- `state_update` — Arbitrary state change
- `presence` — Online users list

---

## File Structure

```
field-room/
├── clawdbot-connector/        # Reusable backend
│   ├── sync-service.js        # WebSocket server
│   ├── clawdbot-client.js     # AI participant connector
│   ├── package.json
│   └── README.md
│
├── examples/
│   └── field-mapping/         # Example implementation
│       ├── client/            # Web UI
│       │   ├── index.html
│       │   └── client.js
│       └── workspace/         # File storage
│
├── docs/
│   ├── QUICKSTART.md
│   ├── API.md
│   └── ARCHITECTURE.md        # This file
│
└── README.md
```

**Key separation:**
- **Connector** = reusable, UI-agnostic
- **Examples** = specific implementations
- **Docs** = how to use it

---

## Multi-User Patterns

### Pattern 1: Co-located Team

**Use case:** Everyone exploring the same site together.

```
Rob: I'm at the north entrance
Sarah: I see you! Look at this drainage issue
@trillian what's the flood risk here?
Trillian: Flood Zone 2, medium risk...
```

**Features:**
- Real-time presence on map
- Shared annotations
- Ambient AI support

---

### Pattern 2: Distributed Team

**Use case:** Team members in different locations.

```
Rob (London): @trillian research Birmingham planning apps
Trillian: Found 12 applications...
Sarah (Birmingham): I can verify those on-site
```

**Features:**
- Async collaboration
- AI does research while humans work
- Persistent context

---

### Pattern 3: Human + AI Pair

**Use case:** Solo user with AI assistant.

```
Rob: @trillian I'm surveying this site, what should I look for?
Trillian: Check for: 1) Boundary markers, 2) Access routes, 3) ...
Rob: Found the markers, adding photos
```

**Features:**
- Conversational workflow
- AI remembers context
- Mix of chat and commands

---

## Scalability Considerations

### Current Design (Simple)

- **WebSocket broadcast** — All messages to all clients
- **File-based state** — JSON files on disk
- **Single sync service** — One Node.js process

**Supports:** ~10-50 concurrent users comfortably

---

### Future Scaling

**For 100s of users:**

1. **Room sharding** — Separate rooms per project/site
2. **Redis pub/sub** — Multi-instance sync services
3. **Database** — PostgreSQL for state (optional)
4. **CDN** — Serve static assets
5. **Load balancer** — Multiple sync service instances

**Example with Redis:**
```javascript
// Each sync service subscribes to room channels
redis.subscribe('field-room:site-a');
redis.on('message', (channel, msg) => {
  broadcast(JSON.parse(msg));
});
```

---

## Security Model

### Current (Development)

⚠️ **No authentication or encryption**

- Any client can connect
- Any user ID can be claimed
- WebSocket is unencrypted
- No rate limiting

**Acceptable for:** Local network, trusted users, prototyping

---

### Production Hardening

**Must add:**

1. **Authentication**
   - JWT tokens
   - OAuth integration
   - Session management

2. **Authorization**
   - User roles (admin, member, viewer)
   - Room access control
   - Feature permissions

3. **Encryption**
   - WSS (WebSocket Secure)
   - HTTPS for HTTP endpoints
   - TLS 1.3+

4. **Rate Limiting**
   - Per-user message limits
   - Invocation throttling
   - Upload size restrictions

5. **Validation**
   - Input sanitization
   - Schema validation (Zod, Joi)
   - GeoJSON validation

**Example auth flow:**
```javascript
ws.on('connection', async (ws, req) => {
  const token = parseToken(req.headers.authorization);
  const user = await verifyToken(token);
  if (!user) {
    ws.close(1008, 'Unauthorized');
    return;
  }
  // Continue with authenticated user
});
```

---

## Extension Points

### Custom Message Types

Add your own:

```javascript
// In sync-service.js
case 'my_custom_type':
  await handleMyCustomType(clientId, msg);
  break;
```

**Example: Voice notes**
```javascript
{
  type: 'voice_note',
  audioUrl: 'https://...',
  duration: 45
}
```

---

### External Integrations

**Planning API:**
```javascript
case 'invoke':
  if (msg.command.includes('planning')) {
    const data = await fetchPlanningData(location);
    broadcast({ type: 'planning_data', data });
  }
  // Then forward to Clawdbot
```

**Weather:**
```javascript
setInterval(async () => {
  const weather = await fetchWeather(location);
  broadcast({ type: 'weather_update', weather });
}, 300000); // Every 5 mins
```

---

### Database Integration

**Optional:** Use PostgreSQL/SQLite instead of JSON files:

```javascript
async function saveDrawing(drawing) {
  await db.query(`
    INSERT INTO drawings (id, data, created_by)
    VALUES ($1, $2, $3)
  `, [drawing.id, JSON.stringify(drawing), drawing.createdBy]);
}
```

**Tradeoffs:**
- ✅ Better for high-frequency updates
- ✅ Structured queries
- ❌ Less inspectable
- ❌ Harder to version control

---

## Clawdbot Integration Details

### Session Per User vs Shared Session

**Option A: One session for all users**
```
All users → Sync Service → Single Clawdbot session
```

- ✅ Simple
- ✅ Shared context
- ❌ Can't distinguish users

**Option B: Session per user**
```
User A → Sync Service → Clawdbot Session A
User B → Sync Service → Clawdbot Session B
```

- ✅ Personal context
- ✅ User-specific memory
- ❌ More sessions to manage

**Current implementation:** Shared session (configurable)

---

### Ambient Context

**Should Clawdbot see all chat?**

**Pros:**
- Rich context for responses
- Can proactively chime in
- Understands conversation flow

**Cons:**
- Token usage increases
- Privacy concerns
- Noise in context

**Current:** Disabled by default, enable with:

```javascript
// In sync-service.js, uncomment:
await sendToClawdbot(`[Ambient] ${chatMsg.from}: ${chatMsg.text}`);
```

---

## Performance Characteristics

**Latency:**
- Human chat: <50ms (WebSocket broadcast)
- Clawdbot invoke: 1-5s (depends on complexity)
- Drawing sync: <100ms (file write + broadcast)

**Throughput:**
- Chat: Thousands of messages/second
- Invocations: Limited by Clawdbot (sequential)
- File ops: Depends on disk I/O

**Memory:**
- ~10MB base
- +1-2MB per connected client
- Chat history capped at 100 messages

---

## Future Directions

### Voice Integration

Real-time voice chat + transcription:

```javascript
{
  type: 'voice',
  userId: 'rob',
  audioStream: '...',
  transcription: '...'  // Live transcription
}
```

### 3D Avatar Presence

Track orientation and gestures in 3D space:

```javascript
{
  type: 'avatar_update',
  userId: 'rob',
  position: [x, y, z],
  rotation: [pitch, yaw, roll],
  gesture: 'pointing'
}
```

### Persistent Drawings with History

Version control for drawings (like git):

```javascript
{
  type: 'drawing',
  drawing: {
    id: 'boundary-1',
    version: 3,
    history: [...]
  }
}
```

### Multi-Room Support

One sync service, multiple rooms:

```javascript
{
  type: 'auth',
  userId: 'rob',
  roomId: 'site-a'  // Join specific room
}
```

---

## Comparison to Alternatives

### vs Traditional Chatbot

| Traditional | Field Room |
|-------------|------------|
| 1:1 conversation | Multi-user room |
| No shared state | Persistent workspace |
| Command → Response | Ambient participation |
| No presence | Real-time presence |

### vs Slack/Discord Bot

| Slack Bot | Field Room |
|-----------|------------|
| Platform-specific | UI-agnostic |
| Message-centric | State-centric |
| Limited file handling | Native workspace |
| External to workflow | Embedded in workflow |

### vs Custom Backend

| Custom Backend | Field Room |
|----------------|------------|
| Build everything | Reusable connector |
| Database required | File-based |
| Complex scaling | Simple to start |
| Roll your own AI | Clawdbot integration |

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

Field Room creates a **shared workspace** where humans and AI collaborate naturally. The sync service is the room, Clawdbot is a participant, and clients are windows into that space.

**Core innovation:** Treating AI as an ambient participant in a persistent multi-user environment, not a request-response service.

**Next:** Build your UI, connect to the sync service, and create unique collaborative experiences.
