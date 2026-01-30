/**
 * Clawdbot Room Client
 * 
 * Connects a Clawdbot session to a Field Room as an AI participant.
 * 
 * Usage:
 *   node clawdbot-client.js
 * 
 * Or from a Clawdbot skill:
 *   exec('node /path/to/clawdbot-client.js', { background: true })
 */

const WebSocket = require('ws');

// Configuration
const CONFIG = {
  SYNC_URL: process.env.SYNC_URL || 'ws://localhost:3738',
  AI_USER_ID: process.env.AI_USER_ID || 'trillian',
  SESSION_KEY: process.env.SESSION_KEY || 'field-room',
  AUTO_RESPOND: process.env.AUTO_RESPOND === 'true', // Auto-respond to mentions
};

let ws = null;
let reconnectTimer = null;
const RECONNECT_DELAY = 5000;

console.log('[Clawdbot Client] Starting...');
console.log('[Config]', JSON.stringify(CONFIG, null, 2));

function connect() {
  ws = new WebSocket(CONFIG.SYNC_URL);

  ws.on('open', () => {
    console.log('[Connected] Joined room as', CONFIG.AI_USER_ID);
    
    // Authenticate
    send({
      type: 'auth',
      userId: CONFIG.AI_USER_ID,
      userType: 'ai',
      metadata: {
        sessionKey: CONFIG.SESSION_KEY,
        capabilities: ['research', 'analysis', 'spatial']
      }
    });
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(msg);
    } catch (err) {
      console.error('[Message Error]', err);
    }
  });

  ws.on('close', () => {
    console.log('[Disconnected] Reconnecting in', RECONNECT_DELAY, 'ms');
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
  });

  ws.on('error', (err) => {
    console.error('[WebSocket Error]', err.message);
  });
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'state':
      console.log('[State] Received workspace state');
      break;

    case 'history':
      console.log('[History]', msg.messages.length, 'recent messages');
      break;

    case 'chat':
      // Ambient chat - log but don't respond automatically
      console.log(`[Chat] ${msg.from}: ${msg.text}`);
      
      // Check if mentioned
      if (isMentioned(msg.text)) {
        console.log('[Mentioned] Auto-respond:', CONFIG.AUTO_RESPOND);
        // The sync service will handle forwarding invocations
      }
      break;

    case 'invoke':
      // Direct invocation - sync service handles this
      console.log(`[Invoke] ${msg.from}: ${msg.command}`);
      break;

    case 'clawdbot':
      // Response from another Clawdbot or echo of our own
      if (msg.from !== CONFIG.AI_USER_ID) {
        console.log(`[AI] ${msg.from}: ${msg.text}`);
      }
      break;

    case 'presence':
      console.log('[Presence]', msg.users.length, 'users online');
      break;

    case 'join':
      console.log(`[Join] ${msg.userId} (${msg.userType})`);
      break;

    case 'move':
      console.log(`[Move] ${msg.userId} →`, msg.location?.name || 'unknown');
      break;

    case 'drawing':
      console.log('[Drawing]', msg.drawing.id, msg.drawing.type);
      break;

    default:
      console.log('[Unknown]', msg.type);
  }
}

function isMentioned(text) {
  const patterns = [
    new RegExp(`@${CONFIG.AI_USER_ID}\\b`, 'i'),
    new RegExp(`\\b${CONFIG.AI_USER_ID}\\b`, 'i'),
  ];
  return patterns.some(p => p.test(text));
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[Shutdown] Disconnecting...');
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.close();
  process.exit(0);
});

// Start
connect();
