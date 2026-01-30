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
   │                     (localhost:18789)                  │
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
const ROOM_TOKEN = process.env.ROOM_TOKEN;
if (!ROOM_TOKEN) {
  console.error('[Fatal] ROOM_TOKEN not set');
  process.exit(1);
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'ws://localhost');
  const token = url.searchParams.get('token');

  if (token !== ROOM_TOKEN) {
    console.warn('[Auth] Invalid token from', req.socket.remoteAddress);
    ws.close(1008, 'Unauthorized');
    return;
  }

  // Continue with normal connection...
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
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp    # HTTP (for certbot)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
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

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/www/field-room/workspace

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
```

---

### 5. OpenClaw Gateway (localhost only)

**Gateway should NOT be exposed publicly.**

OpenClaw Gateway should be bound to loopback only on the VPS:

```json5
{
  gateway: {
    port: 18789,
    bind: "loopback",
    http: {
      endpoints: {
        chatCompletions: { enabled: true }
      }
    }
  }
}
```

The sync service connects to `http://127.0.0.1:18789` locally.

```bash
openclaw gateway start
```

---

## .env File for VPS

```bash
# OpenClaw Gateway (local)
OPENCLAW_API=http://127.0.0.1:18789
OPENCLAW_TOKEN=your-gateway-token

# Room auth
ROOM_TOKEN=generated-room-token

# Settings
SYNC_PORT=3738
AI_USER_ID=pauline
AI_SESSION_USER=field-room
CONTEXT_MESSAGES=10
LOG_CHAT=true
WORKSPACE_PATH=/var/www/field-room/workspace
```

---

## Client Connection (from local machine)

**Web client:**
```
https://room.axisdesign.vs.mythic-beasts.com?token=YOUR_ROOM_TOKEN
```

**AI client from another machine:**
```bash
SYNC_URL=wss://room.axisdesign.vs.mythic-beasts.com \
ROOM_TOKEN=your_room_token \
AI_USER_ID=pauline \
node clawdbot-client.js
```

---

## Alternative: Tailscale (Simpler)

If you already use Tailscale:

```bash
# On VPS
tailscale up

# Connect via Tailscale IP — no nginx/SSL needed
ws://100.x.x.x:3738
```

Benefits: end-to-end encryption, no nginx needed, network-level auth.

---

## Security Checklist

Before going live:

- [ ] SSL certificate configured (Let's Encrypt)
- [ ] Room token authentication enabled
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

```bash
# Service status
sudo systemctl status field-room
sudo journalctl -u field-room -f

# Health check
curl https://room.axisdesign.vs.mythic-beasts.com/health

# nginx logs
sudo tail -f /var/log/nginx/access.log
```

---

**Status:** Not yet deployed. Test locally first, then return to this guide.
