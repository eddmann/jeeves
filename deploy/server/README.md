# Server Deployment

Run Jeeves on any server with Docker. One command to install, Watchtower handles updates.

## Prerequisites

- Docker Engine
- Docker Compose v2 plugin (or standalone `docker-compose`)

## Quick Setup

```bash
curl -fsSL https://raw.githubusercontent.com/eddmann/jeeves/main/deploy/server/setup.sh | bash
```

The script will:

1. Check that Docker and Compose are installed
2. Prompt for Telegram credentials and auth method (API key or OAuth)
3. Optionally configure Tailscale for SSH access
4. Generate all config files in `/opt/jeeves` (or your chosen directory)
5. Pull images and start the stack

## Manual Setup

```bash
mkdir -p /opt/jeeves && cd /opt/jeeves

# Create .env from env.example
cp env.example .env
# Edit .env — set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ANTHROPIC_API_KEY

# If using OAuth instead of API key:
# cp /path/to/auth.json .

# Create docker-compose.yml (see setup.sh for the full template)
# Then start:
docker compose up -d
```

## How Updates Work

[Watchtower](https://containrrr.dev/watchtower/) polls GHCR every 5 minutes. When a new image is pushed, Watchtower pulls it and restarts Jeeves automatically.

## Tailscale (Optional)

The setup script can configure a [Tailscale](https://tailscale.com/) sidecar for SSH access to the Jeeves container from any device on your tailnet. You'll need a reusable auth key from the [Tailscale admin console](https://login.tailscale.com/admin/settings/keys).

Once configured, SSH in with:

```bash
ssh root@jeeves  # from any device on your tailnet
```

## Monitoring

```bash
cd /opt/jeeves

# Service status
docker compose ps

# Jeeves logs
docker compose logs -f jeeves

# Watchtower logs (update history)
docker compose logs watchtower
```

## File Layout

```
/opt/jeeves/
  docker-compose.yml
  .env
  auth.json          # only if using OAuth
```

The workspace volume is managed by Docker and persists across container restarts and image updates.
