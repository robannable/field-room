/**
 * Field Room Sync Service
 * 
 * Reusable WebSocket server that creates a shared room for:
 * - Human-to-human chat
 * - AI participation (via OpenClaw Gateway)
 * - Presence tracking
 * - State synchronization
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  SYNC_PORT: process.env.SYNC_PORT || 3738,
  OPENCLAW_API: process.env.OPENCLAW_API || 'http://127.0.0.1:18789',
  OPENCLAW_TOKEN: process.env.OPENCLAW_TOKEN || '',
  WORKSPACE_PATH: process.env.WORKSPACE_PATH || './workspace',
  AI_USER_ID: process.env.AI_USER_ID || 'pauline',
  AI_SESSION_USER: process.env.AI_SESSION_USER || 'field-room',
  LOG_CHAT: process.env.LOG_CHAT !== 'false',
  CONTEXT_MESSAGES: parseInt(process.env.CONTEXT_MESSAGES || '10', 10),
};

console.log('[Sync Service] Starting...');
console.log('[Config]', JSON.stringify({ ...CONFIG, OPENCLAW_TOKEN: CONFIG.OPENCLAW_TOKEN ? '***' : '(none)' }, null, 2));

// Connected clients: Map<clientId, ClientInfo>
const clients = new Map();

// Recent chat history (for late joiners and AI context)
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

  const state = await loadState();
  sendTo(ws, { type: 'state', data: state });
  sendTo(ws, { type: 'history', messages: chatHistory.slice(-20) });

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

  chatHistory.push(chatMsg);
  if (chatHistory.length > MAX_HISTORY) chatHistory.shift();

  if (CONFIG.LOG_CHAT) await logChat(chatMsg);

  // Broadcast to all (including sender for confirmation)
  broadcast(chatMsg);

  // Check if the AI is mentioned — if so, treat as an invocation
  if (isMentioned(msg.text)) {
    console.log(`[Mention] ${client.userId} mentioned ${CONFIG.AI_USER_ID}`);
    await processAIRequest(client.userId, msg.text, chatMsg.id);
  }
}

// Invoke: Direct request to AI
async function handleInvoke(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  console.log(`[Invoke] ${client.userId}: ${msg.command}`);
  await processAIRequest(client.userId, msg.command, msg.id);
}

/**
 * Process an AI request by sending it to OpenClaw Gateway's
 * chat completions endpoint with recent conversation context.
 */
async function processAIRequest(fromUser, text, replyToId) {
  // Broadcast typing indicator
  broadcast({
    type: 'typing',
    userId: CONFIG.AI_USER_ID,
    timestamp: Date.now()
  });

  try {
    // Build context from recent chat history
    const contextMessages = buildContext(text, fromUser);
    const response = await callOpenClaw(contextMessages);

    const responseMsg = {
      type: 'ai_response',
      id: generateId(),
      from: CONFIG.AI_USER_ID,
      text: response,
      inReplyTo: replyToId || null,
      timestamp: Date.now()
    };

    chatHistory.push(responseMsg);
    if (chatHistory.length > MAX_HISTORY) chatHistory.shift();

    broadcast(responseMsg);

    if (CONFIG.LOG_CHAT) await logChat(responseMsg);
  } catch (err) {
    console.error('[AI Error]', err);
    broadcast({
      type: 'error',
      text: `Failed to get AI response: ${err.message}`,
      timestamp: Date.now()
    });
  }
}

/**
 * Build OpenAI-compatible messages array from recent chat history.
 */
function buildContext(currentText, fromUser) {
  const messages = [];

  // System message: set the AI's identity and context
  messages.push({
    role: 'system',
    content: `You are ${CONFIG.AI_USER_ID}, an AI participant in a collaborative Field Room. ` +
      `Multiple humans and AIs share this space in real-time. ` +
      `You can see recent conversation context. Respond naturally as a helpful, knowledgeable participant. ` +
      `Keep responses concise unless detail is needed. ` +
      `You have access to tools and workspace files — use them when helpful. ` +
      `You share a workspace with your main session, so memory files and project files are available. ` +
      `The person addressing you is "${fromUser}".`
  });

  // Add recent chat as context
  const recent = chatHistory.slice(-CONFIG.CONTEXT_MESSAGES);
  for (const msg of recent) {
    if (msg.from === CONFIG.AI_USER_ID) {
      messages.push({ role: 'assistant', content: msg.text });
    } else {
      messages.push({ role: 'user', content: `${msg.from}: ${msg.text}` });
    }
  }

  // Add the current message (may already be in history, but ensure it's last)
  const lastMsg = messages[messages.length - 1];
  const currentContent = `${fromUser}: ${currentText}`;
  if (!lastMsg || lastMsg.content !== currentContent) {
    messages.push({ role: 'user', content: currentContent });
  }

  return messages;
}

/**
 * Call OpenClaw Gateway's chat completions API.
 */
async function callOpenClaw(messages) {
  const headers = { 'Content-Type': 'application/json' };
  if (CONFIG.OPENCLAW_TOKEN) {
    headers['Authorization'] = `Bearer ${CONFIG.OPENCLAW_TOKEN}`;
  }

  const response = await fetch(`${CONFIG.OPENCLAW_API}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'openclaw:main',
      user: CONFIG.AI_SESSION_USER,
      messages
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenClaw API error ${response.status}: ${body}`);
  }

  const result = await response.json();
  const choice = result.choices?.[0];
  return choice?.message?.content || 'No response';
}

/**
 * Check if the AI is mentioned in a message.
 */
function isMentioned(text) {
  const patterns = [
    new RegExp(`@${CONFIG.AI_USER_ID}\\b`, 'i'),
    new RegExp(`\\b${CONFIG.AI_USER_ID}\\b`, 'i'),
  ];
  return patterns.some(p => p.test(text));
}

// Move: Update user location
async function handleMove(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  client.location = msg.location;
  client.lastSeen = Date.now();

  broadcast({
    type: 'move',
    userId: client.userId,
    location: msg.location,
    timestamp: Date.now()
  }, clientId);

  broadcastPresence();
}

// State update
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

// Drawing
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

// Broadcast presence (includes the AI as a virtual participant)
function broadcastPresence() {
  const presence = Array.from(clients.values()).map(c => ({
    userId: c.userId,
    userType: c.userType,
    location: c.location,
    status: c.status,
    lastSeen: c.lastSeen
  }));

  // Always include the AI as present
  const aiAlreadyConnected = presence.some(p => p.userId === CONFIG.AI_USER_ID);
  if (!aiAlreadyConnected) {
    presence.push({
      userId: CONFIG.AI_USER_ID,
      userType: 'ai',
      location: null,
      status: 'online',
      lastSeen: Date.now()
    });
  }

  broadcast({ type: 'presence', users: presence });
}

// Broadcast to all clients (optionally excluding one)
function broadcast(message, excludeClientId = null) {
  const payload = JSON.stringify(message);
  clients.forEach((client, id) => {
    if (id !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  });
}

function sendTo(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
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
    const data = await fs.readFile(path.join(CONFIG.WORKSPACE_PATH, 'state.json'), 'utf8');
    return JSON.parse(data);
  } catch { return { drawings: [], annotations: [], users: [] }; }
}

async function saveState(state) {
  await fs.writeFile(path.join(CONFIG.WORKSPACE_PATH, 'state.json'), JSON.stringify(state, null, 2));
}

async function saveDrawing(drawing) {
  const filepath = path.join(CONFIG.WORKSPACE_PATH, 'drawings', `${drawing.id}.geojson`);
  await fs.writeFile(filepath, JSON.stringify(drawing, null, 2));
}

async function logChat(msg) {
  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(CONFIG.WORKSPACE_PATH, 'chat-logs', `${today}.jsonl`);
  await fs.appendFile(logFile, JSON.stringify(msg) + '\n');
}

function generateId() {
  return Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
}

// Startup
async function start() {
  await ensureWorkspace();
  server.listen(CONFIG.SYNC_PORT, '0.0.0.0', () => {
    console.log(`[Sync Service] Listening on port ${CONFIG.SYNC_PORT}`);
    console.log(`[Sync Service] WebSocket: ws://0.0.0.0:${CONFIG.SYNC_PORT}`);
    console.log(`[Sync Service] Health: http://localhost:${CONFIG.SYNC_PORT}/health`);
    console.log(`[Sync Service] AI: ${CONFIG.AI_USER_ID} via ${CONFIG.OPENCLAW_API}`);
  });
}

start().catch(err => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});
