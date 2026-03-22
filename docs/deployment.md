# Deployment

This document covers how to run Nexus in production.

---

## npm Global Install

The simplest way to run Nexus on a server with Node.js available.

```bash
# Install globally
npm install -g nexus

# Set your provider key
export ANTHROPIC_API_KEY=sk-ant-...

# Start the gateway
nexus gateway run
```

The gateway will listen on `127.0.0.1:18789` by default. To accept connections from the local network:

```bash
nexus config set gateway '{"bind": "lan"}'
nexus gateway run
```

---

## Running with `tsx` (development / monorepo)

If you are working from the monorepo:

```bash
npm install
npx tsx packages/cli/src/index.ts gateway run
```

---

## systemd (Linux)

Create `/etc/systemd/system/nexus.service`:

```ini
[Unit]
Description=Nexus AI Gateway
After=network.target

[Service]
Type=simple
User=nexus
WorkingDirectory=/opt/nexus
Environment=ANTHROPIC_API_KEY=sk-ant-...
Environment=NEXUS_DB_PATH=/var/lib/nexus/nexus.db
ExecStart=/usr/bin/nexus gateway run
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nexus
sudo systemctl start nexus
sudo journalctl -u nexus -f
```

### Securing with a Gateway Token

```bash
nexus config set security '{"gatewayToken": "your-secret-token"}'
sudo systemctl restart nexus
```

All WebSocket clients must now include `"token": "your-secret-token"` in their `ConnectParams`.

---

## Docker

A minimal `Dockerfile`:

```dockerfile
FROM node:22-alpine

WORKDIR /app

# Install nexus globally
RUN npm install -g nexus

# Expose the gateway port
EXPOSE 18789

# Set database path to a volume-mounted location
ENV NEXUS_DB_PATH=/data/nexus.db

CMD ["nexus", "gateway", "run"]
```

Build and run:

```bash
docker build -t nexus-gateway .

docker run -d \
  --name nexus \
  -p 18789:18789 \
  -v nexus-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e NEXUS_GATEWAY_TOKEN=my-secret-token \
  nexus-gateway
```

Override the bind address so the server listens on all interfaces inside the container:

```bash
docker run -d \
  --name nexus \
  -p 18789:18789 \
  -v nexus-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e NEXUS_BIND=all \
  nexus-gateway
```

> Note: `NEXUS_BIND` is read at startup; alternatively set it once with `nexus config set gateway '{"bind":"all"}'` before building the image.

### Docker Compose

A `docker-compose.yml` is included at the repository root. It builds the image from source and mounts a named volume for persistent data.

```bash
# Copy your env vars and start
cp .env.example .env   # or export them in your shell
docker-compose up -d
docker-compose logs -f nexus
```

To rebuild after code changes:

```bash
docker-compose up -d --build
```

---

## Building the UI

The SolidJS UI must be built before the gateway can serve it at `/ui/`.

```bash
# From the monorepo root
cd packages/ui
npm install
npx vite build
```

The output is written to `packages/ui/dist/`. The gateway serves it from this path by default, or from the path set by `NEXUS_UI_DIST`.

In a Docker image, include the build step:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
RUN cd packages/ui && npx vite build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/packages /app/packages
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json .
RUN npm install -g nexus
EXPOSE 18789
ENV NEXUS_UI_DIST=/app/packages/ui/dist
CMD ["nexus", "gateway", "run"]
```

---

## Reverse Proxy (nginx)

To put Nexus behind nginx with TLS:

```nginx
server {
    listen 443 ssl;
    server_name nexus.example.com;

    ssl_certificate     /etc/letsencrypt/live/nexus.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nexus.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;

        # WebSocket upgrade
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Keep WebSocket connections alive
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

With nginx handling TLS, Nexus itself can remain on `loopback` (default bind). The `gateway.token` config should still be set to authenticate WebSocket clients.

---

## Data and Backup

The database file (`~/.nexus/nexus.db` or `NEXUS_DB_PATH`) contains all sessions, messages, config, and audit logs. Back it up with:

```bash
# Safe online backup using SQLite's backup API
sqlite3 /var/lib/nexus/nexus.db ".backup /var/lib/nexus/nexus-backup.db"
```

Or simply copy the file when the gateway is stopped.

---

## Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Anthropic API key for Claude models |
| `OPENAI_API_KEY` | — | OpenAI API key for GPT models |
| `NEXUS_DB_PATH` | `~/.nexus/nexus.db` | Path to the SQLite database file |
| `NEXUS_PORT` | `18789` | Port the gateway listens on |
| `NEXUS_BIND` | `loopback` | Bind address: `loopback`, `lan`, or `all` |
| `NEXUS_GATEWAY_TOKEN` | — | Shared secret required in `ConnectParams.token` |
| `NEXUS_UI_DIST` | `packages/ui/dist` | Path to the built SolidJS UI assets |
| `NEXUS_LOG_LEVEL` | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error` |

---

## npm Global Install

```bash
npm install -g nexus
nexus onboard
```

The `onboard` command walks through initial configuration (provider keys, bind address, gateway token).
