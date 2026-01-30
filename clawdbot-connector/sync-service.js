/**
 * Field Room Sync Service
 * 
 * Reusable WebSocket server that creates a shared room for:
 * - Human-to-human chat
 * - AI participation (via OpenClaw Gateway)
 * - Presence tracking
 * - Notes pinned to locations
 * - Location-based meetings with transcripts
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

// Notes: persistent, location-pinned text { id, lat, lng, name, text, author, timestamp }
let notes = [];

// Active meetings: Map<meetingId, MeetingState>
const activeMeetings = new Map();

// HTTP server for health checks
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      clients: clients.size,
      notes: notes.length,
      activeMeetings: activeMeetings.size,
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
      // Leave any meetings
      leaveAllMeetings(client.userId);
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
    case 'note':
      await handleNote(clientId, msg);
      break;
    case 'meeting':
      await handleMeeting(clientId, msg);
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

// === AUTH ===

async function handleAuth(clientId, ws, msg) {
  const { userId, userType = 'human', metadata = {} } = msg;

  clients.set(clientId, {
    ws, userId, userType, metadata,
    location: null,
    status: 'online',
    joinedAt: Date.now(),
    lastSeen: Date.now()
  });

  console.log(`[Auth] ${userId} joined (${userType})`);

  const state = await loadState();
  sendTo(ws, { type: 'state', data: state });
  sendTo(ws, { type: 'history', messages: chatHistory.slice(-20) });
  sendTo(ws, { type: 'notes', notes });
  sendTo(ws, { type: 'meetings', meetings: getActiveMeetingsSummary() });

  broadcast({ type: 'join', userId, userType, timestamp: Date.now() }, clientId);
  broadcastPresence();
}

// === CHAT ===

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

  broadcast(chatMsg);

  // Record in active meetings this user is part of
  recordMeetingChat(client.userId, msg.text);

  // Check for AI mention
  if (isMentioned(msg.text)) {
    console.log(`[Mention] ${client.userId} mentioned ${CONFIG.AI_USER_ID}`);
    await processAIRequest(client.userId, msg.text, chatMsg.id);
  }
}

// === INVOKE ===

async function handleInvoke(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;
  console.log(`[Invoke] ${client.userId}: ${msg.command}`);
  await processAIRequest(client.userId, msg.command, msg.id);
}

// === NOTES ===

async function handleNote(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  if (msg.action === 'add') {
    const note = {
      id: generateId(),
      lat: msg.lat,
      lng: msg.lng,
      locationName: msg.locationName || null,
      text: msg.text,
      author: client.userId,
      timestamp: Date.now()
    };

    notes.push(note);
    await saveNotes();

    console.log(`[Note] ${client.userId} left note at ${msg.locationName || `${msg.lat},${msg.lng}`}`);

    broadcast({
      type: 'note_added',
      note,
      timestamp: Date.now()
    });

  } else if (msg.action === 'delete' && msg.noteId) {
    const idx = notes.findIndex(n => n.id === msg.noteId && n.author === client.userId);
    if (idx !== -1) {
      notes.splice(idx, 1);
      await saveNotes();
      broadcast({ type: 'note_deleted', noteId: msg.noteId, timestamp: Date.now() });
    }
  }
}

// === MEETINGS ===

async function handleMeeting(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  switch (msg.action) {
    case 'start':
      return startMeeting(client, msg);
    case 'join':
      return joinMeeting(client, msg.meetingId);
    case 'end':
      return endMeeting(client, msg.meetingId);
    default:
      console.warn('[Meeting] Unknown action:', msg.action);
  }
}

function startMeeting(client, msg) {
  if (!msg.lat || !msg.lng) {
    sendToUser(client.userId, { type: 'error', text: 'Select a location on the map before starting a meeting.' });
    return;
  }

  const meetingId = generateId();
  const now = new Date();

  const meeting = {
    id: meetingId,
    lat: msg.lat,
    lng: msg.lng,
    locationName: msg.locationName || `${msg.lat.toFixed(4)}, ${msg.lng.toFixed(4)}`,
    startedBy: client.userId,
    startedAt: now.toISOString(),
    participants: new Set([client.userId]),
    transcript: [
      `MEETING TRANSCRIPT`,
      `==================`,
      `Location: ${msg.locationName || `${msg.lat.toFixed(5)}, ${msg.lng.toFixed(5)}`}`,
      `Date: ${now.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
      `Time: ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
      `Started by: ${client.userId}`,
      ``,
      `--- Meeting Started ---`,
      ``
    ]
  };

  activeMeetings.set(meetingId, meeting);
  console.log(`[Meeting] ${client.userId} started meeting at ${meeting.locationName}`);

  broadcast({
    type: 'meeting_started',
    meeting: {
      id: meetingId,
      lat: msg.lat,
      lng: msg.lng,
      locationName: meeting.locationName,
      startedBy: client.userId,
      participants: [client.userId]
    },
    timestamp: Date.now()
  });
}

function joinMeeting(client, meetingId) {
  let meeting = activeMeetings.get(meetingId);
  // Allow prefix matching for short IDs
  if (!meeting) {
    for (const [id, m] of activeMeetings) {
      if (id.startsWith(meetingId)) { meeting = m; meetingId = id; break; }
    }
  }
  if (!meeting) {
    sendToUser(client.userId, { type: 'error', text: 'Meeting not found.' });
    return;
  }

  if (meeting.participants.has(client.userId)) {
    sendToUser(client.userId, { type: 'error', text: 'You are already in this meeting.' });
    return;
  }

  meeting.participants.add(client.userId);
  meeting.transcript.push(`[${client.userId} joined the meeting]`);
  meeting.transcript.push(``);

  console.log(`[Meeting] ${client.userId} joined meeting ${meetingId}`);

  broadcast({
    type: 'meeting_joined',
    meetingId,
    userId: client.userId,
    participants: [...meeting.participants],
    timestamp: Date.now()
  });
}

async function endMeeting(client, meetingId) {
  let meeting = activeMeetings.get(meetingId);
  if (!meeting) {
    for (const [id, m] of activeMeetings) {
      if (id.startsWith(meetingId)) { meeting = m; meetingId = id; break; }
    }
  }
  if (!meeting) {
    sendToUser(client.userId, { type: 'error', text: 'Meeting not found.' });
    return;
  }

  if (!meeting.participants.has(client.userId)) {
    sendToUser(client.userId, { type: 'error', text: 'You are not in this meeting.' });
    return;
  }

  // Finalize transcript
  const now = new Date();
  meeting.transcript.push(``);
  meeting.transcript.push(`--- Meeting Ended at ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ---`);
  meeting.transcript.push(`Participants: ${[...meeting.participants].join(', ')}`);

  const transcriptText = meeting.transcript.join('\n');

  // Save transcript as a file in workspace
  const fileName = `meeting_${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 16).replace(':', '')}.txt`;
  const meetingsDir = path.join(CONFIG.WORKSPACE_PATH, 'meetings');
  await fs.mkdir(meetingsDir, { recursive: true });
  await fs.writeFile(path.join(meetingsDir, fileName), transcriptText);

  // Also leave a note at the meeting location
  const note = {
    id: generateId(),
    lat: meeting.lat,
    lng: meeting.lng,
    locationName: meeting.locationName,
    text: `📋 Meeting transcript: ${fileName} (${[...meeting.participants].join(', ')})`,
    author: 'system',
    timestamp: Date.now(),
    meetingFile: fileName
  };
  notes.push(note);
  await saveNotes();

  console.log(`[Meeting] Ended. Transcript saved: ${fileName}`);

  activeMeetings.delete(meetingId);

  broadcast({
    type: 'meeting_ended',
    meetingId,
    fileName,
    locationName: meeting.locationName,
    endedBy: client.userId,
    note,
    timestamp: Date.now()
  });
}

function recordMeetingChat(userId, text) {
  for (const [, meeting] of activeMeetings) {
    if (meeting.participants.has(userId)) {
      meeting.transcript.push(`${userId}: ${text}`);
    }
  }
}

function leaveAllMeetings(userId) {
  for (const [, meeting] of activeMeetings) {
    if (meeting.participants.has(userId)) {
      meeting.participants.delete(userId);
      meeting.transcript.push(`[${userId} disconnected]`);
    }
  }
}

function getActiveMeetingsSummary() {
  return [...activeMeetings.values()].map(m => ({
    id: m.id,
    lat: m.lat,
    lng: m.lng,
    locationName: m.locationName,
    startedBy: m.startedBy,
    startedAt: m.startedAt,
    participants: [...m.participants]
  }));
}

// === AI ===

async function processAIRequest(fromUser, text, replyToId) {
  broadcast({ type: 'typing', userId: CONFIG.AI_USER_ID, timestamp: Date.now() });

  try {
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

    // Record AI responses in meetings too
    recordMeetingChat(CONFIG.AI_USER_ID, response);

    broadcast(responseMsg);
    if (CONFIG.LOG_CHAT) await logChat(responseMsg);
  } catch (err) {
    console.error('[AI Error]', err);
    broadcast({ type: 'error', text: `Failed to get AI response: ${err.message}`, timestamp: Date.now() });
  }
}

function buildContext(currentText, fromUser) {
  const messages = [];

  // System prompt with notes context
  let systemContent = `You are ${CONFIG.AI_USER_ID}, an AI participant in a collaborative Field Room. ` +
    `Multiple humans and AIs share this space in real-time. ` +
    `You can see recent conversation context. Respond naturally as a helpful, knowledgeable participant. ` +
    `Keep responses concise unless detail is needed. ` +
    `You have access to tools and workspace files — use them when helpful. ` +
    `You share a workspace with your main session, so memory files and project files are available. ` +
    `The person addressing you is "${fromUser}".`;

  // Add nearby notes context if the user has a location
  const userClient = [...clients.values()].find(c => c.userId === fromUser);
  if (userClient?.location && notes.length > 0) {
    const nearbyNotes = getNotesNear(userClient.location.lat, userClient.location.lng, 500);
    if (nearbyNotes.length > 0) {
      systemContent += `\n\nNotes left at or near the user's current location:\n`;
      nearbyNotes.forEach(n => {
        systemContent += `- "${n.text}" (by ${n.author} at ${n.locationName || 'unnamed location'})\n`;
      });
    }
  }

  messages.push({ role: 'system', content: systemContent });

  const recent = chatHistory.slice(-CONFIG.CONTEXT_MESSAGES);
  for (const msg of recent) {
    if (msg.from === CONFIG.AI_USER_ID) {
      messages.push({ role: 'assistant', content: msg.text });
    } else {
      messages.push({ role: 'user', content: `${msg.from}: ${msg.text}` });
    }
  }

  const lastMsg = messages[messages.length - 1];
  const currentContent = `${fromUser}: ${currentText}`;
  if (!lastMsg || lastMsg.content !== currentContent) {
    messages.push({ role: 'user', content: currentContent });
  }

  return messages;
}

async function callOpenClaw(messages) {
  const headers = { 'Content-Type': 'application/json' };
  if (CONFIG.OPENCLAW_TOKEN) {
    headers['Authorization'] = `Bearer ${CONFIG.OPENCLAW_TOKEN}`;
  }

  const response = await fetch(`${CONFIG.OPENCLAW_API}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'openclaw:main', user: CONFIG.AI_SESSION_USER, messages })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenClaw API error ${response.status}: ${body}`);
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content || 'No response';
}

function isMentioned(text) {
  const patterns = [
    new RegExp(`@${CONFIG.AI_USER_ID}\\b`, 'i'),
    new RegExp(`\\b${CONFIG.AI_USER_ID}\\b`, 'i'),
  ];
  return patterns.some(p => p.test(text));
}

// === MOVE ===

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

// === STATE / DRAWING ===

async function handleStateUpdate(clientId, msg) {
  const state = await loadState();
  Object.assign(state, msg.update);
  await saveState(state);
  broadcast({ type: 'state_update', update: msg.update, timestamp: Date.now() }, clientId);
}

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
  broadcast({ type: 'drawing', drawing, timestamp: Date.now() }, clientId);
}

// === PRESENCE ===

function broadcastPresence() {
  const presence = Array.from(clients.values()).map(c => ({
    userId: c.userId,
    userType: c.userType,
    location: c.location,
    status: c.status,
    lastSeen: c.lastSeen
  }));

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

// === BROADCAST HELPERS ===

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

function sendToUser(userId, message) {
  clients.forEach((client) => {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  });
}

// === FILE OPERATIONS ===

async function ensureWorkspace() {
  await fs.mkdir(CONFIG.WORKSPACE_PATH, { recursive: true });
  await fs.mkdir(path.join(CONFIG.WORKSPACE_PATH, 'drawings'), { recursive: true });
  await fs.mkdir(path.join(CONFIG.WORKSPACE_PATH, 'chat-logs'), { recursive: true });
  await fs.mkdir(path.join(CONFIG.WORKSPACE_PATH, 'meetings'), { recursive: true });
  // Load persisted notes
  await loadNotes();
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

async function loadNotes() {
  try {
    const data = await fs.readFile(path.join(CONFIG.WORKSPACE_PATH, 'notes.json'), 'utf8');
    notes = JSON.parse(data);
    console.log(`[Notes] Loaded ${notes.length} notes`);
  } catch { notes = []; }
}

async function saveNotes() {
  await fs.writeFile(path.join(CONFIG.WORKSPACE_PATH, 'notes.json'), JSON.stringify(notes, null, 2));
}

function getNotesNear(lat, lng, radiusMetres) {
  return notes.filter(n => {
    const d = haversineDistance(lat, lng, n.lat, n.lng);
    return d <= radiusMetres;
  });
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
