/**
 * OpenClaw Room Client
 * 
 * Connects an OpenClaw instance to a Field Room as an AI participant.
 * This client monitors the room and can send messages back.
 * 
 * The sync service handles AI invocations via the Gateway API,
 * so this client is primarily for presence and ambient awareness.
 * 
 * Usage:
 *   SYNC_URL=ws://localhost:3738 AI_USER_ID=pauline node clawdbot-client.js
 */

const WebSocket = require('ws');

const CONFIG = {
  SYNC_URL: process.env.SYNC_URL || 'ws://localhost:3738',
  AI_USER_ID: process.env.AI_USER_ID || 'pauline',
  SESSION_KEY: process.env.SESSION_KEY || 'field-room',
  AUTO_RESPOND: process.env.AUTO_RESPOND === 'true',
};

let ws = null;
let reconnectTimer = null;
const RECONNECT_DELAY = 5000;

console.log('[OpenClaw Client] Starting...');
console.log('[Config]', JSON.stringify(CONFIG, null, 2));

function connect() {
  ws = new WebSocket(CONFIG.SYNC_URL);

  ws.on('open', () => {
    console.log('[Connected] Joined room as', CONFIG.AI_USER_ID);
    send({
      type: 'auth',
      userId: CONFIG.AI_USER_ID,
      userType: 'ai',
      metadata: {
        sessionKey: CONFIG.SESSION_KEY,
        capabilities: ['research', 'analysis', 'coding', 'conversation']
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
      console.log(`[Chat] ${msg.from}: ${msg.text}`);
      break;
    case 'ai_response':
      console.log(`[AI] ${msg.from}: ${msg.text}`);
      break;
    case 'presence':
      console.log('[Presence]', msg.users.map(u => u.userId).join(', '));
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

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Export send for programmatic use
module.exports = { send, connect };

process.on('SIGINT', () => {
  console.log('[Shutdown] Disconnecting...');
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.close();
  process.exit(0);
});

// Start if run directly
if (require.main === module) {
  connect();
}
