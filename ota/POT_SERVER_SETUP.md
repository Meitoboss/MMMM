# PO Token Server Setup on OCI

This guide helps you set up the PO Token server on Oracle Cloud Infrastructure (OCI).

## Prerequisites

- OCI Compute Instance with public IP (144.27.127.172 in your case)
- Ubuntu/Debian OS
- Port 8787 available (or customize via env var)

## Installation Steps

### 1. Connect to your OCI instance

```bash
ssh ubuntu@144.27.127.172
```

### 2. Install dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js (if not already installed)
sudo apt install -y nodejs npm

# Install yt-dlp
sudo apt install -y yt-dlp

# Or install via pip if preferred:
# sudo apt install -y python3-pip
# pip install yt-dlp
```

### 3. Verify yt-dlp installation

```bash
yt-dlp --version
```

### 4. Clone or copy the server code

Option A: Copy from your development machine
```bash
# On your dev machine:
scp ota/pot-server.mjs ubuntu@144.27.127.172:~/

# On the OCI instance:
chmod +x ~/pot-server.mjs
```

Option B: Create the file directly on the instance
```bash
cat > ~/pot-server.mjs << 'EOF'
[paste the content of pot-server.mjs here]
EOF
chmod +x ~/pot-server.mjs
```

### 5. Test the server locally

```bash
# Set environment variables
export POT_API_KEY="your-secret-key-here"
export POT_PORT=8787
export POT_HOST=127.0.0.1

# Run the server
node ~/pot-server.mjs
```

You should see:
```
✓ PO Token server listening on http://127.0.0.1:8787
Ready to handle /get_pot and /ping requests
```

### 6. Test the endpoints

In another terminal on the same instance:

```bash
# Health check
curl -X GET http://127.0.0.1:8787/ping

# Generate a token (with API key)
curl -X POST http://127.0.0.1:8787/get_pot \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-secret-key-here" \
  -d '{"content_binding":"dQw4w9WgXcQ"}'
```

### 7. Set up systemd service for auto-start

Create a service file:

```bash
sudo tee /etc/systemd/system/pot-server.service > /dev/null << 'EOF'
[Unit]
Description=PO Token Server for Music space
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu
ExecStart=/usr/bin/node /home/ubuntu/pot-server.mjs
Restart=on-failure
RestartSec=10

# Environment variables
Environment="POT_API_KEY=your-secret-key-here"
Environment="POT_PORT=8787"
Environment="POT_HOST=0.0.0.0"

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable pot-server
sudo systemctl start pot-server

# Check status
sudo systemctl status pot-server

# View logs
sudo journalctl -u pot-server -f
```

### 8. Configure firewall rules in OCI

In OCI Console:
1. Go to Compute → Instances → Your Instance
2. Go to "Attached VNICs" → click your VNIC
3. Go to "Security Lists"
4. Add Ingress Rule:
   - Stateless: No
   - Protocol: TCP
   - Source: 0.0.0.0/0
   - Destination Port Range: 8787
   - Description: "PO Token Server"

Or via CLI:
```bash
# Get your VNIC ID first
oci network vnic list --compartment-id <your-compartment-id>

# Add rule (adjust subnet-id as needed)
oci network security-list update \
  --security-list-id <your-security-list-id> \
  --ingress-security-rules file://ingress-rule.json
```

### 9. Configure in Music space app

In the app's Settings screen:
- **POT Server URL**: `http://144.27.127.172:8787`
- **POT Server Key**: `your-secret-key-here`

Or if using HTTPS with a reverse proxy (recommended):
- **POT Server URL**: `https://pot.yourdomain.com`
- **POT Server Key**: `your-secret-key-here`

### 10. Verify connectivity

Test from your local machine (or another device on the internet):

```bash
curl -X POST http://144.27.127.172:8787/get_pot \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-secret-key-here" \
  -d '{"content_binding":"dQw4w9WgXcQ"}'
```

You should get a response like:
```json
{
  "poToken": "...",
  "expiresAt": "2026-10-08T12:34:56.000Z"
}
```

## Security Recommendations

### 1. Use HTTPS (Recommended)

Set up a reverse proxy with SSL:

**Option A: Using Caddy**

```bash
sudo apt install -y caddy
```

Create Caddyfile:
```bash
sudo tee /etc/caddy/Caddyfile > /dev/null << 'EOF'
pot.yourdomain.com {
  reverse_proxy 127.0.0.1:8787
  encode gzip
}
EOF
```

Start Caddy:
```bash
sudo systemctl enable caddy
sudo systemctl start caddy
```

**Option B: Using nginx**

```bash
sudo apt install -y nginx

# Create nginx config
sudo tee /etc/nginx/sites-available/pot-server > /dev/null << 'EOF'
server {
    listen 443 ssl http2;
    server_name pot.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 80;
    server_name pot.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
EOF

sudo ln -s /etc/nginx/sites-available/pot-server /etc/nginx/sites-enabled/
sudo systemctl enable nginx
sudo systemctl restart nginx
```

### 2. Monitor logs

```bash
# Real-time logs
sudo journalctl -u pot-server -f

# Last 100 lines
sudo journalctl -u pot-server -n 100
```

### 3. Set up alerts

Consider monitoring server health:
```bash
# Add to crontab to check every 5 minutes
*/5 * * * * curl -s -X GET http://127.0.0.1:8787/ping > /dev/null || mail -s "POT Server Down" admin@example.com < /dev/null
```

## Troubleshooting

### Server won't start

```bash
# Check if port is already in use
sudo lsof -i :8787

# Check logs
sudo journalctl -u pot-server -n 50
```

### yt-dlp errors

```bash
# Update yt-dlp
sudo apt update && sudo apt upgrade yt-dlp
# Or via pip:
pip install --upgrade yt-dlp
```

### Token generation slow

- PO token generation can take a few seconds
- The app has an 8-second timeout (see MINT_TIMEOUT_MS in remote.ts)
- Tokens are cached for 12 hours to reduce repeated requests

### Connection refused from app

1. Verify public IP is correct (144.27.127.172)
2. Check OCI firewall rules allow port 8787
3. Verify API key matches
4. Check server is running: `systemctl status pot-server`

## Performance Tips

1. **Token caching**: Tokens are cached in-memory for 12 hours
2. **Connection pooling**: Consider using a process manager like PM2 for better resource management
3. **Load balancing**: For high traffic, run multiple instances behind a load balancer

## Stopping the server

```bash
# Stop the service
sudo systemctl stop pot-server

# Or kill the process
pkill -f pot-server.mjs

# Restart
sudo systemctl restart pot-server
```
