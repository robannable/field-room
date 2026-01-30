/**
 * Field Room Client - Enhanced with map and auxiliary panels
 * Collaborative workspace with Clawdbot backend
 */

const SYNC_URL = window.FIELD_ROOM_SYNC_URL || 'ws://localhost:3738';
const AI_USER = window.FIELD_ROOM_AI_USER || 'pauline';

let ws = null;
let currentUserId = null;
let reconnectTimer = null;
let map = null;

// DOM elements
const authOverlay = document.getElementById('auth-overlay');
const usernameInput = document.getElementById('username');
const joinBtn = document.getElementById('join-btn');
const statusEl = document.getElementById('status');
const outputEl = document.getElementById('output');
const commandInput = document.getElementById('command-input');
const commandForm = document.getElementById('command-form');
const presenceListEl = document.getElementById('presence-list');
const auxTabs = document.querySelectorAll('.aux-tab');
const auxContent = document.getElementById('aux-panel-content');
const commandPanel = document.getElementById('command-panel');

// === AUTH ===

joinBtn.addEventListener('click', () => {
  const username = usernameInput.value.trim();
  if (username) {
    currentUserId = username;
    authOverlay.classList.add('hidden');
    connect();
    initMap();
  }
});

usernameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

// === INPUT ===

commandForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = commandInput.value.trim();
  if (text) {
    sendMessage(text);
    commandInput.value = '';
  }
});

// === COMMAND PANEL ===

commandPanel.addEventListener('click', (e) => {
  const cmd = e.target.closest('.cmd');
  if (cmd && cmd.dataset.suggest) {
    let suggestion = cmd.dataset.suggest.replace('{ai}', AI_USER);
    commandInput.value = suggestion;
    commandInput.focus();
    // Position cursor after mention
    const mentionEnd = suggestion.indexOf(' ') + 1;
    commandInput.setSelectionRange(mentionEnd, mentionEnd);
  }
});

// === WEBSOCKET ===

function connect() {
  updateStatus('Connecting...');
  ws = new WebSocket(SYNC_URL);

  ws.onopen = () => {
    updateStatus('Connected', true);
    commandInput.disabled = false;
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
    commandInput.disabled = true;
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

  // Handle meta commands
  if (text === '/who') {
    showWhoTab();
    return;
  }

  if (text === '/help') {
    showHelpTab();
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

  outputEl.appendChild(div);
  outputEl.scrollTop = outputEl.scrollHeight;
}

function addSystemMessage(text, isError = false) {
  const div = document.createElement('div');
  div.className = 'message system';
  if (isError) div.style.background = '#fee2e2';
  const textEl = document.createElement('div');
  textEl.className = 'message-text';
  textEl.textContent = text;
  div.appendChild(textEl);
  outputEl.appendChild(div);
  outputEl.scrollTop = outputEl.scrollHeight;
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
  outputEl.appendChild(div);
  outputEl.scrollTop = outputEl.scrollHeight;

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
      location.textContent = user.location.name;
      div.appendChild(location);
    }

    presenceListEl.appendChild(div);
  });
}

function updateStatus(text, connected = null) {
  statusEl.textContent = text;
  if (connected !== null) {
    statusEl.className = 'connection-status ' + (connected ? 'connected' : 'disconnected');
  }
}

// === AUXILIARY PANEL TABS ===

auxTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    switchTab(tabName);
    auxTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});

function switchTab(tabName) {
  switch (tabName) {
    case 'activity':
      showActivityTab();
      break;
    case 'users':
      showUsersTab();
      break;
    case 'help':
      showHelpTab();
      break;
  }
}

function showActivityTab() {
  auxContent.innerHTML = `
    <div>
      <h3 style="margin-bottom: 12px; font-size: 14px; font-weight: 600;">Activity Feed</h3>
      <p style="color: var(--text-secondary); font-size: 13px;">Recent room activity will appear here.</p>
    </div>
  `;
}

function showUsersTab() {
  auxContent.innerHTML = `
    <div>
      <h3 style="margin-bottom: 12px; font-size: 14px; font-weight: 600;">Users Online</h3>
      <div id="aux-presence-list"></div>
    </div>
  `;
  // Mirror presence from sidebar
  const auxPresence = document.getElementById('aux-presence-list');
  auxPresence.innerHTML = presenceListEl.innerHTML;
}

function showWhoTab() {
  // Activate users tab and switch to it
  const usersTab = document.querySelector('[data-tab="users"]');
  usersTab.click();
}

function showHelpTab() {
  auxContent.innerHTML = `
    <div>
      <h3 style="margin-bottom: 12px; font-size: 14px; font-weight: 600;">Field Room Help</h3>
      <div style="color: var(--text-secondary); font-size: 13px; line-height: 1.6;">
        <p style="margin-bottom: 12px;"><strong>Welcome to Field Room</strong> — a collaborative workspace where you work alongside Clawdbot.</p>
        
        <p style="margin-bottom: 8px;"><strong>Chat:</strong> Type messages to communicate with others in the room.</p>
        
        <p style="margin-bottom: 8px;"><strong>Invoke AI:</strong> Mention <code>@${AI_USER}</code> to get AI assistance:</p>
        <ul style="margin-left: 20px; margin-bottom: 12px;">
          <li>@${AI_USER} survey this area</li>
          <li>@${AI_USER} research planning constraints</li>
          <li>@${AI_USER} summarize our discussion</li>
        </ul>
        
        <p style="margin-bottom: 8px;"><strong>Commands:</strong></p>
        <ul style="margin-left: 20px;">
          <li><code>/who</code> - Show who's online</li>
          <li><code>/help</code> - Show this help</li>
        </ul>
        
        <p style="margin-top: 12px; font-size: 12px; opacity: 0.7;">The AI sees recent conversation context and can help with research, analysis, and collaboration.</p>
      </div>
    </div>
  `;
}

// === MAP ===

function initMap() {
  try {
    map = L.map('map').setView([52.486, -1.904], 13); // Birmingham, UK default

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    // Try to get user's location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          map.setView([latitude, longitude], 15);
          
          // Add marker for user
          L.marker([latitude, longitude])
            .addTo(map)
            .bindPopup(`${currentUserId} (you)`)
            .openPopup();
            
          // Notify room of location
          send({
            type: 'move',
            location: {
              lat: latitude,
              lng: longitude,
              name: 'Current location'
            }
          });
        },
        (error) => {
          console.warn('Geolocation error:', error);
        }
      );
    }
  } catch (err) {
    console.error('Map initialization failed:', err);
  }
}

// === RESIZE HANDLES ===

const resizeHandleColumns = document.getElementById('resize-handle-columns');
const resizeHandlePanels = document.getElementById('resize-handle-panels');
const textColumn = document.getElementById('text-column');
const mapSection = document.getElementById('map-section');
const auxPanel = document.getElementById('aux-panel');

let isResizingColumns = false;
let isResizingPanels = false;

resizeHandleColumns.addEventListener('mousedown', () => {
  isResizingColumns = true;
  document.body.style.cursor = 'col-resize';
});

resizeHandlePanels.addEventListener('mousedown', () => {
  isResizingPanels = true;
  document.body.style.cursor = 'row-resize';
});

document.addEventListener('mousemove', (e) => {
  if (isResizingColumns) {
    const newWidth = Math.max(300, Math.min(600, e.clientX));
    textColumn.style.width = newWidth + 'px';
    if (map) setTimeout(() => map.invalidateSize(), 100);
  }
  
  if (isResizingPanels) {
    const container = document.querySelector('.right-column');
    const containerRect = container.getBoundingClientRect();
    const newHeight = Math.max(150, Math.min(500, containerRect.bottom - e.clientY));
    auxPanel.style.height = newHeight + 'px';
  }
});

document.addEventListener('mouseup', () => {
  if (isResizingColumns || isResizingPanels) {
    isResizingColumns = false;
    isResizingPanels = false;
    document.body.style.cursor = '';
    if (map) map.invalidateSize();
  }
});

// === UTILITIES ===

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

// Initialize help tab by default
showActivityTab();
