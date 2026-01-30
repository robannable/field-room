/**
 * Field Room Sync Service
 * 
 * Reusable WebSocket server that creates a shared room for:
 * - Human-to-human chat
 * - Clawdbot participation
 * - Presence tracking
 * - State synchronization
 * 
 * Use this as-is or fork for your own multi-user Clawdbot project.
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  SYNC_PORT: process.env.SYNC_PORT || 3738,
  CLAWDBOT_API: process.env.CLAWDBOT_API || 'http://localhost:3737',
  WORKSPACE_PATH: process.env.WORKSPACE_PATH || './workspace',
  AI_USER_ID: process.env.AI_USER_ID || 'trillian',
  AI_SESSION_KEY: process.env.AI_SESSION_KEY || 'field-room',
  LOG_CHAT: process.env.LOG_CHAT !== 'false', // Log chat to files
};

console.log('[Sync Service] Starting...');
console.log('[Config]', JSON.stringify(CONFIG, null, 2));

// Connected clients: Map<clientId, ClientInfo>
const clients = new Map();

// Recent chat history (for late joiners)
const chatHistory = [];
const MAX_HISTORY = 100;

// HTTP server for health checks
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      clients: clients.size,
      workspace: CONFIG.WORKSPACE_PATH,
      uptime: process.uptime()
    }));
  } else if (req.url === '/state') {
    // Return current room state
    const state = await loadState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const clientId = generateId();
  console.log(`[Connection] New client: ${clientId} from ${req.socket.remoteAddress}`);

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      await handleMessage(clientId, ws, msg);
    } catch (err) {
      console.error('[Error] Message handling failed:', err);
      sendTo(ws, { type: 'error', error: err.message });
    }
  });

  ws.on('close', () => {
    const client = clients.get(clientId);
    if (client) {
      console.log(`[Disconnect] ${client.userId} (${clientId})`);
      clients.delete(clientId);
      broadcastPresence();
    }
  });

  ws.on('error', (err) => {
    console.error('[WebSocket Error]', err);
  });
});

// Message handler
async function handleMessage(clientId, ws, msg) {
  switch (msg.type) {
    case 'auth':
      await handleAuth(clientId, ws, msg);
      break;

    case 'chat':
      await handleChat(clientId, msg);
      break;

    case 'invoke':
      await handleInvoke(clientId, msg);
      break;

    case 'move':
      await handleMove(clientId, msg);
      break;

    case 'state_update':
      await handleStateUpdate(clientId, msg);
      break;

    case 'drawing':
      await handleDrawing(clientId, msg);
      break;

    case 'ping':
      sendTo(ws, { type: 'pong', timestamp: Date.now() });
      break;

    default:
      console.warn('[Unknown message type]', msg.type);
  }
}

// Auth: Register client
async function handleAuth(clientId, ws, msg) {
  const { userId, userType = 'human', metadata = {} } = msg;

  clients.set(clientId, {
    ws,
    userId,
    userType,
    metadata,
    location: null,
    status: 'online',
    joinedAt: Date.now(),
    lastSeen: Date.now()
  });

  console.log(`[Auth] ${userId} joined (${userType})`);

  // Send current state
  const state = await loadState();
  sendTo(ws, { type: 'state', data: state });

  // Send recent chat history
  sendTo(ws, { type: 'history', messages: chatHistory.slice(-20) });

  // Broadcast join
  broadcast({
    type: 'join',
    userId,
    userType,
    timestamp: Date.now()
  }, clientId);

  broadcastPresence();
}

// Chat: Human-to-human message
async function handleChat(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  const chatMsg = {
    type: 'chat',
    id: generateId(),
    from: client.userId,
    text: msg.text,
    timestamp: Date.now()
  };

  // Store in history
  chatHistory.push(chatMsg);
  if (chatHistory.length > MAX_HISTORY) {
    chatHistory.shift();
  }

  // Log to file
  if (CONFIG.LOG_CHAT) {
    await logChat(chatMsg);
  }

  // Broadcast to all
  broadcast(chatMsg);

  // Forward to Clawdbot as ambient context
  await sendAmbientToClawdbot(chatMsg);
}

// Invoke: Direct request to Clawdbot
async function handleInvoke(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  console.log(`[Invoke] ${client.userId}: ${msg.command}`);

  // Broadcast "typing" indicator
  broadcast({
    type: 'typing',
    userId: CONFIG.AI_USER_ID,
    timestamp: Date.now()
  });

  try {
    // Send to Clawdbot
    const response = await sendToClawdbot(msg.command);

    // Broadcast response
    const responseMsg = {
      type: 'clawdbot',
      id: generateId(),
      from: CONFIG.AI_USER_ID,
      text: response,
      inReplyTo: msg.id || null,
      timestamp: Date.now()
    };

    chatHistory.push(responseMsg);
    broadcast(responseMsg);

    if (CONFIG.LOG_CHAT) {
      await logChat(responseMsg);
    }
  } catch (err) {
    console.error('[Invoke Error]', err);
    broadcast({
      type: 'error',
      text: `Failed to invoke Clawdbot: ${err.message}`,
      timestamp: Date.now()
    });
  }
}

// Move: Update user location
async function handleMove(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  client.location = msg.location;
  client.lastSeen = Date.now();

  // Broadcast location update
  broadcast({
    type: 'move',
    userId: client.userId,
    location: msg.location,
    timestamp: Date.now()
  }, clientId);

  broadcastPresence();
}

// State update: Shared workspace state change
async function handleStateUpdate(clientId, msg) {
  const state = await loadState();
  Object.assign(state, msg.update);
  await saveState(state);

  broadcast({
    type: 'state_update',
    update: msg.update,
    timestamp: Date.now()
  }, clientId);
}

// Drawing: Persist and broadcast drawing
async function handleDrawing(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  const drawing = {
    ...msg.drawing,
    id: msg.drawing.id || generateId(),
    createdBy: client.userId,
    createdAt: msg.drawing.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  await saveDrawing(drawing);

  broadcast({
    type: 'drawing',
    drawing,
    timestamp: Date.now()
  }, clientId);
}

// Broadcast presence to all clients
function broadcastPresence() {
  const presence = Array.from(clients.values()).map(c => ({
    userId: c.userId,
    userType: c.userType,
    location: c.location,
    status: c.status,
    lastSeen: c.lastSeen
  }));

  broadcast({ type: 'presence', users: presence });
}

// Send message to all clients except sender
function broadcast(message, excludeClientId = null) {
  const payload = JSON.stringify(message);
  clients.forEach((client, id) => {
    if (id !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  });
}

// Send message to specific WebSocket
function sendTo(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Send message to Clawdbot session
async function sendToClawdbot(message) {
  const response = await fetch(`${CONFIG.CLAWDBOT_API}/api/sessions/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionKey: CONFIG.AI_SESSION_KEY,
      message
    })
  });

  if (!response.ok) {
    throw new Error(`Clawdbot API error: ${response.status}`);
  }

  const result = await response.json();
  return result.response || result.message || 'No response';
}

// Send ambient chat context to Clawdbot (non-blocking)
async function sendAmbientToClawdbot(chatMsg) {
  try {
    // Optional: forward all chat as ambient context
    // Uncomment if you want Clawdbot to see all conversation
    // await sendToClawdbot(`[Ambient] ${chatMsg.from}: ${chatMsg.text}`);
  } catch (err) {
    console.error('[Ambient forward error]', err.message);
  }
}

// File operations
async function ensureWorkspace() {
  await fs.mkdir(CONFIG.WORKSPACE_PATH, { recursive: true });
  await fs.mkdir(path.join(CONFIG.WORKSPACE_PATH, 'drawings'), { recursive: true });
  await fs.mkdir(path.join(CONFIG.WORKSPACE_PATH, 'chat-logs'), { recursive: true });
}

async function loadState() {
  try {
    const stateFile = path.join(CONFIG.WORKSPACE_PATH, 'state.json');
    const data = await fs.readFile(stateFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return { drawings: [], annotations: [], users: [] };
  }
}

async function saveState(state) {
  const stateFile = path.join(CONFIG.WORKSPACE_PATH, 'state.json');
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
}

async function saveDrawing(drawing) {
  const drawingsDir = path.join(CONFIG.WORKSPACE_PATH, 'drawings');
  const filename = `${drawing.id}.geojson`;
  const filepath = path.join(drawingsDir, filename);
  await fs.writeFile(filepath, JSON.stringify(drawing, null, 2));
}

async function logChat(msg) {
  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(CONFIG.WORKSPACE_PATH, 'chat-logs', `${today}.jsonl`);
  await fs.appendFile(logFile, JSON.stringify(msg) + '\n');
}

// Utility
function generateId() {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

// Startup
async function start() {
  await ensureWorkspace();

  server.listen(CONFIG.SYNC_PORT, () => {
    console.log(`[Sync Service] Listening on port ${CONFIG.SYNC_PORT}`);
    console.log(`[Sync Service] WebSocket: ws://localhost:${CONFIG.SYNC_PORT}`);
    console.log(`[Sync Service] Health: http://localhost:${CONFIG.SYNC_PORT}/health`);
    console.log(`[Sync Service] Workspace: ${CONFIG.WORKSPACE_PATH}`);
  });
}

start().catch(err => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});
