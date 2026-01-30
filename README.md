# Field Room

**Multi-user collaborative workspace with OpenClaw backend**

Inspired by Field Mapping and On-Together: Virtual Coworking, Field Room provides a shared space where humans and AI work together in real-time.

## Core Concept

```
┌─────────────────────────────────────────────────┐
│           SHARED ROOM (Sync Service)            │
│  • Human chat (peer-to-peer)                    │
│  • AI participation (when mentioned or relevant)│
│  • Presence (who's here, where they are)        │
│  • State sync (drawings, annotations, docs)     │
└─────────────────────────────────────────────────┘
         ▲                              ▲
         │                              │
    [Humans]                       [OpenClaw]
```

**Not:** Command → AI → Response  
**But:** Persistent shared space where humans work together, with AI as an ambient participant

## Quick Start

### Prerequisites
- Node.js 18+
- OpenClaw installed: `npm install -g openclaw`

### 1. Start OpenClaw Gateway

```bash
openclaw gateway start
```

### 2. Start Sync Service

```bash
cd clawdbot-connector
npm install
npm start
```

### 3. Open Client

```bash
open examples/field-mapping/client/index.html
# Or serve with: python -m http.server 8000
```

## Architecture

**Two reusable components:**

### 1. Sync Service (`clawdbot-connector/sync-service.js`)
- WebSocket server for real-time room
- Manages presence, chat, state broadcasts
- Detects AI mentions in chat messages and forwards to OpenClaw
- Builds conversation context from last N messages
- **Reusable** — works with any UI

### 2. OpenClaw Client (`clawdbot-connector/clawdbot-client.js`)
- Connects OpenClaw session to the room
- Receives ambient context
- Responds when invoked
- **Reusable** — drop into any OpenClaw workspace

**Example implementation:** `examples/field-mapping/`
- Minimal web client showing the pattern
- Can be replaced with React, Vue, native app, etc.

## Usage Patterns

### Human-to-Human Chat
```
Rob: Hey Sarah, check out grid ref SP 06 86
Sarah: On it, heading there now
```

### Invoke OpenClaw
```
Rob: @pauline research planning constraints here
Pauline: Found 3 applications within 500m...
```

(The AI user name is configurable via `AI_USER_ID` env var — "pauline" is the default.)

### Ambient Announcements
```
Pauline: New planning application filed nearby: 2026/00156/PA
```

### Presence
```
Sarah moved to [52.486, -1.904] Birmingham City Centre
```

## Extending

**To build your own client:**
1. Copy `clawdbot-connector/` to your project
2. Start sync service
3. Connect via WebSocket (see `docs/API.md`)
4. Build your UI (web, desktop, mobile)

**The connector is UI-agnostic** — bring your own interface.

## Documentation

- [Quick Start Guide](docs/QUICKSTART.md) — Get running in 5 minutes
- [API Reference](docs/API.md) — WebSocket protocol & endpoints
- [Architecture](docs/ARCHITECTURE.md) — How it all fits together

## Examples

- **Field Mapping** — Collaborative site intelligence (maps, 3D, annotations)
- *More coming soon...*

## License

MIT

## Credits

Inspired by:
- **Field Mapping** — Text-first collaborative site tool
- **On-Together** — Virtual coworking spaces
- **OpenClaw** — AI agent framework
