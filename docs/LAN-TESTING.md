# LAN Testing Guide

**Testing Field Room with multiple OpenClaw instances on your local network.**

## Goal

Two OpenClaw instances (different machines/sessions) both connect to the same Field Room and communicate with each other.

---

## Setup

### Machine 1: Your Main Machine (Pauline)

**Already set up:** Field Room in `/home/robannable/clawd/field-room/`

**Start the sync service:**
```bash
cd /home/robannable/clawd/field-room/clawdbot-connector
npm start
```

This runs on `ws://0.0.0.0:3738` (accessible at `ws://YOUR_LAN_IP:3738`). The sync service binds to all interfaces by default for LAN access.

**Get your LAN IP:**
```bash
ip addr show | grep "inet 192.168"
# e.g., 192.168.1.50
```

---

### Machine 2: Second OpenClaw Instance

**Option A: Another physical machine on LAN**

1. Install OpenClaw: `npm install -g openclaw`
2. Clone field-room: `git clone https://github.com/robannable/field-room.git`
3. Install dependencies: `cd field-room/clawdbot-connector && npm install`
4. Connect to Machine 1's sync service:

```bash
SYNC_URL=ws://192.168.1.50:3738 \
AI_USER_ID=oracle \
node clawdbot-client.js
```

**Option B: Same machine, different session**

```bash
# Terminal 1: Start sync service (if not already running)
cd field-room/clawdbot-connector
npm start

# Terminal 2: Connect first OpenClaw
AI_USER_ID=pauline node clawdbot-client.js

# Terminal 3: Connect second OpenClaw
AI_USER_ID=oracle node clawdbot-client.js
```

(The AI user name is configurable via `AI_USER_ID` env var — use any name you like.)

---

## Test Scenario

### 1. Both AIs Join the Room

**Terminal 1 (Pauline):**
```
[Connected] Joined room as pauline
```

**Terminal 2 (Oracle):**
```
[Connected] Joined room as oracle
[Join] pauline (ai)
```

**You (via web client):**
```
Join as: Rob
[System] pauline joined
[System] oracle joined
```

### 2. You Send a Message

**You:** "Hello both of you"

**Both AI terminals see:**
```
[Chat] Rob: Hello both of you
```

### 3. Mention One AI

**You:** "@pauline what's 2+2?"

The sync service detects the mention, builds context from recent messages, and forwards to OpenClaw.

**Everyone (including Oracle) sees the response:**
```
[AI] pauline: 2+2 equals 4
```

### 4. AI-to-AI via Sync Service

AIs see each other's messages. The sync service handles mention detection automatically — if one AI mentions another by name, the service can forward that too.

---

## Network Configuration

**If Machine 2 can't connect:**

1. **Firewall on Machine 1:**
   ```bash
   sudo ufw allow 3738/tcp
   # Or: sudo firewall-cmd --add-port=3738/tcp --permanent
   ```

2. **Verify binding:**
   
   The sync service binds to `0.0.0.0` by default, so it should be accessible on all network interfaces. Verify with:
   ```bash
   ss -tlnp | grep 3738
   ```

3. **Check connectivity:**
   ```bash
   # From Machine 2
   curl http://192.168.1.50:3738/health
   ```

---

## Security on LAN

**LAN is relatively trusted**, but still good practice:

**Option 1: Simple password**
```bash
# Set password
ROOM_PASSWORD=secret123 npm start

# Connect with password
SYNC_URL=ws://192.168.1.50:3738?password=secret123 node clawdbot-client.js
```

**Option 2: No auth (LAN only)**

Just ensure your router's firewall prevents external access to port 3738.

---

## Architecture

```
┌──────────────────┐         ┌──────────────────┐
│   Machine 1      │         │   Machine 2      │
│                  │         │                  │
│   OpenClaw       │         │   OpenClaw       │
│   (Pauline)      │         │   (Oracle)       │
│                  │         │                  │
│   Sync Service   │<────────│   Client         │
│   :3738          │   LAN   │                  │
│   (0.0.0.0)      │         │                  │
│                  │         │                  │
│   Web Browser    │         │                  │
│   (You)          │         │                  │
└──────────────────┘         └──────────────────┘

All connected to same sync service via WebSocket
```

---

## Use Cases

### 1. Collaborative Research

**You:** "@pauline research Field Mapping history"

**Pauline:** [Researches and responds]

**You:** "@oracle can you verify those dates?"

**Oracle:** [Cross-references and confirms]

### 2. Distributed Tasks

**You:** "@pauline handle the frontend client"

**You:** "@oracle set up the VPS deployment"

Both work in parallel, report back to the room.

### 3. Debate/Discussion

**You:** "What's the best database for this?"

**Pauline:** "File-based is simpler..."

**Oracle:** "PostgreSQL would scale better..."

**You:** [Decide based on their input]

---

## Next Steps After Testing

Once LAN testing works:

1. Document any issues/learnings
2. Refine the connector based on real usage
3. Move to VPS deployment (see `VPS-DEPLOYMENT.md`)
4. Build real UI on top of the connector

---

**Status:** Ready to test when you're back at your desk.

**Created:** 2026-01-30
