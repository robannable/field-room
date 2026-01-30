/**
 * Field Room Client - Enhanced with map, location selection, and AI integration
 * Collaborative workspace with OpenClaw backend
 */

const SYNC_URL = window.FIELD_ROOM_SYNC_URL || 'ws://localhost:3738';
const AI_USER = window.FIELD_ROOM_AI_USER || 'pauline';

let ws = null;
let currentUserId = null;
let reconnectTimer = null;
let map = null;

// Location selection state
let selectedLocation = null;    // { lat, lng, name, address }
let selectionMarker = null;     // Leaflet marker
let selectionCircle = null;     // Region of interest circle
const ROI_RADIUS = 250;         // Default region of interest radius in metres
let reverseGeocodeTimeout = null;

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
const locationDisplay = document.getElementById('location-display');

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
  if (!cmd || !cmd.dataset.suggest) return;

  let suggestion = cmd.dataset.suggest.replace('{ai}', AI_USER);

  // Inject location context if a location is selected and the command needs it
  if (cmd.dataset.location !== 'false' && selectedLocation) {
    const locStr = selectedLocation.name || selectedLocation.address ||
      `${selectedLocation.lat.toFixed(5)}, ${selectedLocation.lng.toFixed(5)}`;
    suggestion = suggestion.replace('{location}', locStr);
  } else if (suggestion.includes('{location}')) {
    // No location selected — prompt user
    suggestion = suggestion.replace('{location}', '');
    addSystemMessage('💡 Click on the map to select a location first, then try again.');
  }

  commandInput.value = suggestion;
  commandInput.focus();
  // Cursor at end
  commandInput.setSelectionRange(suggestion.length, suggestion.length);
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
      // Remove typing indicator when response arrives
      const typingEl = document.getElementById('typing-indicator');
      if (typingEl) typingEl.remove();
      renderMessage(msg);
      break;
    case 'presence':
      updatePresence(msg.users);
      break;
    case 'join':
      addSystemMessage(`${msg.userId} joined`);
      break;
    case 'move':
      handleUserMove(msg);
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
  if (text === '/who') { showWhoTab(); return; }
  if (text === '/help') { showHelpTab(); return; }
  if (text === '/where') { showLocationInfo(); return; }
  if (text.startsWith('/goto ')) { searchAndGoto(text.slice(6).trim()); return; }

  // Check if invoking AI
  if (text.startsWith('@' + AI_USER) || text.startsWith('/' + AI_USER)) {
    send({ type: 'invoke', command: text, id: generateId() });
  } else {
    send({ type: 'chat', text });
  }
}

// === MAP ===

function initMap() {
  try {
    map = L.map('map').setView([52.486, -1.904], 13); // Birmingham default

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    // Click to select location
    map.on('click', handleMapClick);

    // Show coords on mouse move
    map.on('mousemove', (e) => {
      const coordsEl = document.getElementById('coords-display');
      if (coordsEl) {
        coordsEl.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
      }
    });

    // Try to get user's actual location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          map.setView([latitude, longitude], 15);
          // Auto-select current position
          selectLocation(latitude, longitude);
          // Notify room
          send({
            type: 'move',
            location: { lat: latitude, lng: longitude, name: 'Current location' }
          });
        },
        (error) => console.warn('Geolocation error:', error)
      );
    }
  } catch (err) {
    console.error('Map initialization failed:', err);
  }
}

/**
 * Handle map click — select a location and show region of interest
 */
function handleMapClick(e) {
  selectLocation(e.latlng.lat, e.latlng.lng);
}

/**
 * Select a location on the map with marker and ROI circle
 */
function selectLocation(lat, lng) {
  selectedLocation = { lat, lng, name: null, address: null };

  // Update or create marker
  if (selectionMarker) {
    selectionMarker.setLatLng([lat, lng]);
  } else {
    selectionMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'selection-marker',
        html: '<div class="selection-pin">📍</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 28]
      })
    }).addTo(map);
  }

  // Update or create ROI circle
  if (selectionCircle) {
    selectionCircle.setLatLng([lat, lng]);
  } else {
    selectionCircle = L.circle([lat, lng], {
      radius: ROI_RADIUS,
      color: '#3b82f6',
      fillColor: '#3b82f6',
      fillOpacity: 0.1,
      weight: 2,
      dashArray: '6, 6'
    }).addTo(map);
  }

  // Update display immediately with coords
  updateLocationDisplay(`${lat.toFixed(5)}, ${lng.toFixed(5)}`, 'Looking up location...');

  // Reverse geocode (debounced)
  clearTimeout(reverseGeocodeTimeout);
  reverseGeocodeTimeout = setTimeout(() => reverseGeocode(lat, lng), 300);
}

/**
 * Reverse geocode coordinates to a place name via Nominatim
 */
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?` + new URLSearchParams({
      lat: lat.toFixed(6),
      lon: lng.toFixed(6),
      format: 'json',
      addressdetails: 1,
      zoom: 18
    });

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) throw new Error('Geocoding failed');

    const result = await response.json();

    if (result && result.address) {
      const addr = result.address;
      // Build a useful place name from address components
      const name = buildPlaceName(addr);
      const fullAddress = result.display_name;

      selectedLocation.name = name;
      selectedLocation.address = fullAddress;

      updateLocationDisplay(name, fullAddress);

      // Update marker popup
      if (selectionMarker) {
        selectionMarker.bindPopup(`<strong>${escapeHtml(name)}</strong><br><small>${escapeHtml(fullAddress)}</small>`);
      }
    }
  } catch (err) {
    console.warn('Reverse geocoding failed:', err);
    updateLocationDisplay(
      `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      'Could not resolve place name'
    );
  }
}

/**
 * Build a human-readable place name from Nominatim address components
 */
function buildPlaceName(addr) {
  // Try to build something like "Park Street, Digbeth, Birmingham"
  const parts = [];

  // Street-level detail
  if (addr.road) parts.push(addr.road);
  else if (addr.pedestrian) parts.push(addr.pedestrian);
  else if (addr.footway) parts.push(addr.footway);
  else if (addr.building) parts.push(addr.building);
  else if (addr.amenity) parts.push(addr.amenity);

  // Neighbourhood/suburb
  if (addr.neighbourhood) parts.push(addr.neighbourhood);
  else if (addr.suburb) parts.push(addr.suburb);
  else if (addr.quarter) parts.push(addr.quarter);

  // City/town
  if (addr.city) parts.push(addr.city);
  else if (addr.town) parts.push(addr.town);
  else if (addr.village) parts.push(addr.village);
  else if (addr.hamlet) parts.push(addr.hamlet);

  return parts.length > 0 ? parts.join(', ') : 'Unknown location';
}

/**
 * Update the location display bar
 */
function updateLocationDisplay(primary, secondary) {
  if (locationDisplay) {
    locationDisplay.innerHTML = `
      <div class="location-primary">${escapeHtml(primary)}</div>
      ${secondary ? `<div class="location-secondary">${escapeHtml(secondary)}</div>` : ''}
    `;
    locationDisplay.classList.add('active');
  }

  // Update command panel to show location-aware state
  updateCommandPanelState();
}

/**
 * Update command panel buttons to reflect whether a location is selected
 */
function updateCommandPanelState() {
  const cmds = commandPanel.querySelectorAll('.cmd[data-location]');
  cmds.forEach(cmd => {
    if (cmd.dataset.location !== 'false') {
      cmd.classList.toggle('location-ready', !!selectedLocation?.name);
    }
  });
}

/**
 * Search for a place name and move the map there
 */
async function searchAndGoto(query) {
  if (!query) {
    addSystemMessage('Usage: /goto <place name or address>', true);
    return;
  }

  addSystemMessage(`Searching for "${query}"...`);

  try {
    const url = `https://nominatim.openstreetmap.org/search?` + new URLSearchParams({
      q: query,
      format: 'json',
      addressdetails: 1,
      limit: 1
    });

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    const results = await response.json();

    if (results.length === 0) {
      addSystemMessage(`No results found for "${query}"`, true);
      return;
    }

    const result = results[0];
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);

    map.setView([lat, lng], 16, { animate: true });
    selectLocation(lat, lng);
    addSystemMessage(`📍 ${result.display_name}`);
  } catch (err) {
    addSystemMessage('Search failed: ' + err.message, true);
  }
}

/**
 * Show current location info in chat
 */
function showLocationInfo() {
  if (!selectedLocation) {
    addSystemMessage('No location selected. Click on the map to select one.');
    return;
  }
  const name = selectedLocation.name || 'Unnamed';
  const coords = `${selectedLocation.lat.toFixed(5)}, ${selectedLocation.lng.toFixed(5)}`;
  addSystemMessage(`📍 ${name} (${coords}) — ROI: ${ROI_RADIUS}m radius`);
}

// === HANDLE USER MOVEMENT ===

const userMarkers = new Map();

function handleUserMove(msg) {
  if (!map || !msg.location) return;
  const { lat, lng } = msg.location;

  addSystemMessage(`${msg.userId} moved to ${msg.location.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`}`);

  // Update or create marker for this user
  if (userMarkers.has(msg.userId)) {
    userMarkers.get(msg.userId).setLatLng([lat, lng]);
  } else {
    const marker = L.circleMarker([lat, lng], {
      radius: 6,
      color: '#22c55e',
      fillColor: '#22c55e',
      fillOpacity: 0.8,
      weight: 2
    }).addTo(map).bindTooltip(msg.userId, { permanent: false, direction: 'top' });
    userMarkers.set(msg.userId, marker);
  }
}

// === MESSAGE RENDERING ===

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

// === PRESENCE ===

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
    case 'activity': showActivityTab(); break;
    case 'users': showUsersTab(); break;
    case 'help': showHelpTab(); break;
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
  document.getElementById('aux-presence-list').innerHTML = presenceListEl.innerHTML;
}

function showWhoTab() {
  document.querySelector('[data-tab="users"]').click();
}

function showHelpTab() {
  auxContent.innerHTML = `
    <div>
      <h3 style="margin-bottom: 12px; font-size: 14px; font-weight: 600;">Field Room Help</h3>
      <div style="color: var(--text-secondary); font-size: 13px; line-height: 1.6;">
        <p style="margin-bottom: 12px;"><strong>Welcome to Field Room</strong> — a collaborative workspace with AI assistance.</p>

        <p style="margin-bottom: 8px;"><strong>Map:</strong> Click anywhere to select a location. A region of interest (${ROI_RADIUS}m radius) will be shown. Commands will use this location automatically.</p>

        <p style="margin-bottom: 8px;"><strong>AI:</strong> Mention <code>@${AI_USER}</code> or use the command buttons:</p>
        <ul style="margin-left: 20px; margin-bottom: 12px;">
          <li>@${AI_USER} survey this area — analyses the selected location</li>
          <li>@${AI_USER} research planning constraints — checks planning data</li>
          <li>@${AI_USER} what's nearby? — points of interest</li>
        </ul>

        <p style="margin-bottom: 8px;"><strong>Commands:</strong></p>
        <ul style="margin-left: 20px;">
          <li><code>/goto &lt;place&gt;</code> — Search and jump to a location</li>
          <li><code>/where</code> — Show current selected location</li>
          <li><code>/who</code> — Show who's online</li>
          <li><code>/help</code> — Show this help</li>
        </ul>
      </div>
    </div>
  `;
}

// === MAP RESIZE HANDLES ===

const resizeHandleColumns = document.getElementById('resize-handle-columns');
const resizeHandlePanels = document.getElementById('resize-handle-panels');
const textColumn = document.getElementById('text-column');
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

function escapeHtml(text) {
  if (!text) return '';
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
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

// Initialize default tab
showActivityTab();
