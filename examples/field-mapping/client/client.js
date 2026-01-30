/**
 * Field Room Example Client
 * Demonstrates connecting to the sync service
 */

const SYNC_URL = window.FIELD_ROOM_SYNC_URL || 'ws://localhost:3738';
const AI_USER = window.FIELD_ROOM_AI_USER || 'pauline';

let ws = null;
let currentUserId = null;
let reconnectTimer = null;

// DOM elements
const authOverlay = document.getElementById('auth-overlay');
const usernameInput = document.getElementById('username');
const joinBtn = document.getElementById('join-btn');
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const presenceListEl = document.getElementById('presence-list');

// Auth
joinBtn.addEventListener('click', () => {
  const username = usernameInput.value.trim();
  if (username) {
    currentUserId = username;
    authOverlay.classList.add('hidden');
    connect();
  }
});

usernameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

// Input
inputEl.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const text = inputEl.value.trim();
    if (text) {
      sendMessage(text);
      inputEl.value = '';
    }
  }
});

function connect() {
  updateStatus('Connecting...');
  ws = new WebSocket(SYNC_URL);

  ws.onopen = () => {
    updateStatus('Connected', true);
    inputEl.disabled = false;
    send({ type: 'auth', userId: currentUserId, userType: 'human' });
  };

  ws.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch (err) {
      console.error('Message parse error:', err);
    }
  };

  ws.onclose = () => {
    updateStatus('Disconnected', false);
    inputEl.disabled = true;
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = (err) => console.error('WebSocket error:', err);
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'state':
      console.log('State received:', msg.data);
      break;
    case 'history':
      msg.messages.forEach(m => renderMessage(m));
      break;
    case 'chat':
      renderMessage(msg);
      break;
    case 'ai_response':
      renderMessage(msg);
      break;
    case 'presence':
      updatePresence(msg.users);
      break;
    case 'join':
      addSystemMessage(`${msg.userId} joined`);
      break;
    case 'move':
      addSystemMessage(`${msg.userId} moved to ${msg.location?.name || 'unknown location'}`);
      break;
    case 'drawing':
      addSystemMessage(`${msg.drawing.createdBy} added a drawing`);
      break;
    case 'typing':
      showTyping(msg.userId);
      break;
    case 'error':
      addSystemMessage(`Error: ${msg.error || msg.text}`, true);
      break;
    default:
      console.log('Unknown message type:', msg.type);
  }
}

function sendMessage(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    addSystemMessage('Not connected', true);
    return;
  }

  // Check if invoking AI
  if (text.startsWith('@' + AI_USER) || text.startsWith('/' + AI_USER)) {
    send({ type: 'invoke', command: text, id: generateId() });
  } else {
    send({ type: 'chat', text });
  }
}

function renderMessage(msg) {
  const div = document.createElement('div');
  div.className = 'message';

  if (msg.type === 'ai_response' || msg.from === AI_USER) {
    div.classList.add('ai');
  } else if (msg.from === currentUserId) {
    div.classList.add('self');
  } else {
    div.classList.add('human');
  }

  const fromEl = document.createElement('div');
  fromEl.className = 'message-from';
  fromEl.textContent = msg.from;
  div.appendChild(fromEl);

  const textEl = document.createElement('div');
  textEl.className = 'message-text';
  textEl.textContent = msg.text;
  div.appendChild(textEl);

  const timeEl = document.createElement('div');
  timeEl.className = 'message-time';
  timeEl.textContent = formatTime(msg.timestamp);
  div.appendChild(timeEl);

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addSystemMessage(text, isError = false) {
  const div = document.createElement('div');
  div.className = 'message system';
  if (isError) div.style.background = '#fee2e2';
  const textEl = document.createElement('div');
  textEl.className = 'message-text';
  textEl.textContent = text;
  div.appendChild(textEl);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

let typingTimeout = null;
function showTyping(userId) {
  const existing = document.getElementById('typing-indicator');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = 'typing-indicator';
  div.className = 'message system';
  div.style.opacity = '0.6';
  div.innerHTML = `<div class="message-text">${userId} is thinking...</div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    const el = document.getElementById('typing-indicator');
    if (el) el.remove();
  }, 30000);
}

function updatePresence(users) {
  presenceListEl.innerHTML = '';
  users.forEach(user => {
    const div = document.createElement('div');
    div.className = 'user';

    const indicator = document.createElement('div');
    indicator.className = 'user-indicator';
    if (user.userType === 'ai') indicator.classList.add('ai');
    div.appendChild(indicator);

    const name = document.createElement('span');
    name.className = 'user-name';
    name.textContent = user.userId;
    div.appendChild(name);

    if (user.location?.name) {
      const location = document.createElement('span');
      location.className = 'user-location';
      location.textContent = ` - ${user.location.name}`;
      div.appendChild(location);
    }

    presenceListEl.appendChild(div);
  });
}

function updateStatus(text, connected = null) {
  statusEl.textContent = text;
  if (connected !== null) {
    statusEl.className = connected ? 'connected' : 'disconnected';
  }
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

window.addEventListener('beforeunload', () => {
  if (ws) ws.close();
  if (reconnectTimer) clearTimeout(reconnectTimer);
});
