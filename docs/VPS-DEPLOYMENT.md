# VPS Deployment Guide

**For future reference:** Deploying Field Room on a public VPS with proper security.

## Target: axisdesign VPS

**Host:** 176.126.244.122 (axisdesign.vs.mythic-beasts.com)  
**SSH:** `ssh axisdesign`

## Security Requirements

⚠️ **VPS is publicly accessible** — requires authentication, encryption, and firewall rules.

---

## Architecture

```
Internet                VPS (Public IP)              Local Machine
   │                          │                            │
   ├─ WSS (443) ─────────> nginx ─────> sync-service      │
   │  + SSL cert              │          (localhost:3738)  │
   │  + token auth            │                            │
   │                          │                            │
   │                     OpenClaw Gateway                  │
   │                     (localhost:18789)                 │
   │                     - NOT exposed -                   │
   │                                                        │
   └──────────────────── Encrypted WebSocket ─────────────┘
```

---

## Security Layers

### 1. Nginx Reverse Proxy with SSL

**Install certbot + nginx:**
```bash
ssh axisdesign
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx
```

**Nginx config:** `/etc/nginx/sites-available/field-room`
```nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name room.axisdesign.vs.mythic-beasts.com;
    return 301 https://$server_name$request_uri;
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    server_name room.axisdesign.vs.mythic-beasts.com;
    
    # SSL (managed by certbot)
    ssl_certificate /etc/letsencrypt/live/room.axisdesign.vs.mythic-beasts.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/room.axisdesign.vs.mythic-beasts.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # WebSocket endpoint (with auth)
    location / {
        # Require token in URL or header
        if ($arg_token = "") {
            return 401 "Token required";
        }
        
        proxy_pass http://127.0.0.1:3738;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # Timeouts for long-lived connections
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
    
    # Health check (no auth required)
    location /health {
        proxy_pass http://127.0.0.1:3738/health;
    }
}

# OpenClaw API (separate subdomain, highly restricted)
server {
    listen 443 ssl http2;
    server_name api.axisdesign.vs.mythic-beasts.com;
    
    ssl_certificate /etc/letsencrypt/live/api.axisdesign.vs.mythic-beasts.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.axisdesign.vs.mythic-beasts.com/privkey.pem;
    
    location /v1/ {
        # Require Bearer token
        if ($http_authorization != "Bearer $OPENCLAW_API_TOKEN") {
            return 401;
        }
        
        proxy_pass http://127.0.0.1:18789;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    # Block everything else
    location / {
        return 403;
    }
}
```

**Enable site:**
```bash
sudo ln -s /etc/nginx/sites-available/field-room /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Get SSL certificate:**
```bash
sudo certbot --nginx -d room.axisdesign.vs.mythic-beasts.com
```

---

### 2. Token Authentication in Sync Service

**Modify `sync-service.js`:**

```javascript
// At top of file
const ROOM_TOKEN = process.env.ROOM_TOKEN;
if (!ROOM_TOKEN) {
  console.error('[Fatal] ROOM_TOKEN not set');
  process.exit(1);
}

// In WebSocket connection handler
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'ws://localhost');
  const token = url.searchParams.get('token');
  
  if (token !== ROOM_TOKEN) {
    console.warn('[Auth] Invalid token from', req.socket.remoteAddress);
    ws.close(1008, 'Unauthorized');
    return;
  }
  
  // Continue with normal connection...
  const clientId = generateId();
  console.log(`[Connection] Authorized client: ${clientId}`);
  
  // ... rest of handler
});
```

**Generate secure token:**
```bash
openssl rand -hex 32
# Store in .env
```

---

### 3. Firewall Rules (UFW)

```bash
# Default deny
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow only necessary ports
sudo ufw allow 22/tcp    # SSH (from your IP only, ideally)
sudo ufw allow 80/tcp    # HTTP (for certbot)
sudo ufw allow 443/tcp   # HTTPS

# Enable firewall
sudo ufw enable
sudo ufw status verbose
```

**Restrict SSH to your IP (optional but recommended):**
```bash
sudo ufw delete allow 22/tcp
sudo ufw allow from YOUR_HOME_IP to any port 22 proto tcp
```

---

### 4. Systemd Service (Auto-restart)

**File:** `/etc/systemd/system/field-room.service`

```ini
[Unit]
Description=Field Room Sync Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/field-room/clawdbot-connector
EnvironmentFile=/var/www/field-room/.env
ExecStart=/usr/bin/node sync-service.js
Restart=always
RestartSec=10

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/www/field-room/workspace

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=field-room

[Install]
WantedBy=multi-user.target
```

**Enable and start:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable field-room
sudo systemctl start field-room
sudo systemctl status field-room

# View logs
sudo journalctl -u field-room -f
```

---

### 5. OpenClaw Gateway (localhost only)

**Gateway should NOT be exposed publicly.**

**Config:** `~/.config/openclaw/gateway.json`

```json
{
  "host": "127.0.0.1",
  "port": 18789,
  "workspace": "/var/www/field-room/workspace",
  "api": {
    "enabled": true,
    "cors": ["http://127.0.0.1:3738"]
  }
}
```

**Start Gateway:**
```bash
openclaw gateway start
```

---

## Installation Script

**File:** `deploy-vps.sh`

```bash
#!/bin/bash
set -e

echo "🌐 Field Room VPS Deployment"
echo ""

# Check we're on VPS
if [ "$(hostname)" != "axisdesign" ]; then
  echo "⚠️  Run this on the VPS: ssh axisdesign"
  exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
sudo apt update
sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx ufw

# Install OpenClaw
echo "🤖 Installing OpenClaw..."
npm install -g openclaw

# Clone repo
echo "📥 Cloning field-room..."
cd /var/www
sudo git clone https://github.com/robannable/field-room.git
sudo chown -R www-data:www-data field-room
cd field-room/clawdbot-connector
sudo -u www-data npm install

# Generate tokens
echo "🔐 Generating tokens..."
ROOM_TOKEN=$(openssl rand -hex 32)
OPENCLAW_TOKEN=$(openssl rand -hex 32)

sudo -u www-data tee /var/www/field-room/.env > /dev/null << EOF
ROOM_TOKEN=$ROOM_TOKEN
OPENCLAW_TOKEN=$OPENCLAW_TOKEN
SYNC_PORT=3738
OPENCLAW_API=http://127.0.0.1:18789
WORKSPACE_PATH=/var/www/field-room/workspace
AI_USER_ID=pauline
LOG_CHAT=true
EOF

echo ""
echo "✅ Tokens generated:"
echo "   ROOM_TOKEN=$ROOM_TOKEN"
echo "   OPENCLAW_TOKEN=$OPENCLAW_TOKEN"
echo ""
echo "⚠️  Save these somewhere safe!"
echo ""

# Configure firewall
echo "🔥 Configuring firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
echo "y" | sudo ufw enable

# Set up nginx
echo "🌐 Configuring nginx..."
# (Copy nginx config from above into /etc/nginx/sites-available/field-room)
# (Enable site, get SSL cert)

# Set up systemd service
echo "⚙️  Setting up systemd service..."
# (Copy service file from above into /etc/systemd/system/field-room.service)
sudo systemctl daemon-reload
sudo systemctl enable field-room
sudo systemctl start field-room

# Start OpenClaw Gateway
echo "🤖 Starting OpenClaw Gateway..."
openclaw gateway start

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Connect with:"
echo "  wss://room.axisdesign.vs.mythic-beasts.com?token=$ROOM_TOKEN"
echo ""
echo "Health check:"
echo "  https://room.axisdesign.vs.mythic-beasts.com/health"
echo ""
```

---

## Client Connection (from local machine)

**Modified `clawdbot-client.js`:**

```javascript
const CONFIG = {
  SYNC_URL: process.env.SYNC_URL || 'wss://room.axisdesign.vs.mythic-beasts.com',
  ROOM_TOKEN: process.env.ROOM_TOKEN,  // Required!
  AI_USER_ID: process.env.AI_USER_ID || 'pauline',
};

const wsUrl = `${CONFIG.SYNC_URL}?token=${CONFIG.ROOM_TOKEN}`;
const ws = new WebSocket(wsUrl);
```

**Run from local OpenClaw:**
```bash
SYNC_URL=wss://room.axisdesign.vs.mythic-beasts.com \
ROOM_TOKEN=your_secret_token \
AI_USER_ID=pauline \
node clawdbot-client.js
```

---

## Alternative: Tailscale (Simpler)

**If you already use Tailscale:**

```bash
# On VPS
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Get VPS Tailscale IP
tailscale ip -4
# e.g., 100.x.x.x

# On local machine, connect via Tailscale network
wss://100.x.x.x:3738
```

**Benefits:**
- End-to-end encryption
- No need for nginx/SSL
- Simpler auth (network-level)
- Not exposed to public internet

---

## Multi-Instance Communication Pattern

```
Your Local Machine              VPS (Public/Tailscale)
┌─────────────────┐            ┌──────────────────┐
│   Pauline       │            │     Oracle       │
│  (your main     │            │  (VPS instance)  │
│   OpenClaw)     │            │                  │
└────────┬────────┘            └────────┬─────────┘
         │                               │
         │   Both connect as AI participants
         │                               │
         └────────────┬──────────────────┘
                      │
              ┌───────▼────────┐
              │  Field Room    │
              │  (on VPS)      │
              │                │
              │  Rob (human)   │
              │  also in room  │
              └────────────────┘
```

**Result:** Two OpenClaw instances + you, all in same room, collaborating.

---

## Security Checklist

Before going live:

- [ ] SSL certificate configured (Let's Encrypt)
- [ ] Token authentication enabled
- [ ] Firewall rules active (ufw)
- [ ] OpenClaw Gateway on localhost only
- [ ] Systemd service with restart policy
- [ ] Rate limiting configured (nginx)
- [ ] Input validation in sync service
- [ ] Logs configured (journalctl)
- [ ] Backup strategy for workspace/
- [ ] Monitoring/alerting set up

---

## Monitoring

**Check service status:**
```bash
sudo systemctl status field-room
sudo journalctl -u field-room -f
```

**Check connections:**
```bash
curl https://room.axisdesign.vs.mythic-beasts.com/health
```

**nginx logs:**
```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## Cost Considerations

**Traffic:** WebSocket connections are low-bandwidth (mostly text).

**Compute:** Sync service is lightweight (Node.js, few MB RAM).

**Storage:** Chat logs + drawings accumulate. Monitor workspace/ size.

**SSL:** Let's Encrypt is free, auto-renews.

---

## Next Steps (when ready)

1. Run `deploy-vps.sh` on axisdesign VPS
2. Note the generated tokens (save securely)
3. Configure DNS for `room.axisdesign.vs.mythic-beasts.com`
4. Test connection from local OpenClaw
5. Invite second OpenClaw instance to join

---

**Status:** Not yet deployed. Test locally first, then return to this guide.

**Created:** 2026-01-30  
**For:** Future VPS deployment with proper security
