#!/usr/bin/env bash
set -euo pipefail

# ─── Flags ────────────────────────────────────────────────────────────────────

REINSTALL=false
for arg in "$@"; do
  case "$arg" in
    --reinstall) REINSTALL=true ;;
    --help|-h)
      echo "Usage: setup.sh [--reinstall]"
      echo "  --reinstall  Remove existing Docker containers, volumes, images, and files before setup"
      exit 0
      ;;
  esac
done

# ─── Colors ────────────────────────────────────────────────────────────────────

if [[ -e /dev/tty ]] && command -v tput &>/dev/null; then
  BOLD=$(tput bold)
  DIM=$(tput dim)
  GREEN=$(tput setaf 2)
  YELLOW=$(tput setaf 3)
  RED=$(tput setaf 1)
  CYAN=$(tput setaf 6)
  RESET=$(tput sgr0)
else
  BOLD="" DIM="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
fi

# ─── Helpers ───────────────────────────────────────────────────────────────────

info()    { echo "${CYAN}==>${RESET} ${BOLD}$*${RESET}"; }
warn()    { echo "${YELLOW}⚠  $*${RESET}"; }
error()   { echo "${RED}✘  $*${RESET}" >&2; }
success() { echo "${GREEN}✔  $*${RESET}"; }

prompt() {
  local var="$1" label="$2"
  local value
  read -rp "  ${BOLD}? ${label}:${RESET} " value < /dev/tty
  eval "$var=\$value"
}

prompt_secret() {
  local var="$1" label="$2"
  local value
  read -rsp "  ${BOLD}? ${label}:${RESET} " value < /dev/tty
  echo
  eval "$var=\$value"
}

# ─── Prerequisites ─────────────────────────────────────────────────────────────

echo
echo "${BOLD}Jeeves Server Setup${RESET}"
echo "${DIM}───────────────────${RESET}"
echo

info "Checking prerequisites..."
echo

# Docker binary
if ! command -v docker &>/dev/null; then
  error "Docker not found. Install Docker first: https://docs.docker.com/engine/install/"
  exit 1
fi
success "Docker found"

# Docker Compose (v2 plugin or standalone)
if docker compose version &>/dev/null; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  error "Neither 'docker compose' (v2 plugin) nor 'docker-compose' found."
  echo "  Install the Compose plugin: https://docs.docker.com/compose/install/"
  exit 1
fi
success "Compose found ($COMPOSE)"

# Docker daemon
if ! docker info &>/dev/null 2>&1; then
  error "Docker daemon is not running. Start Docker and try again."
  exit 1
fi
success "Docker daemon running"

# ─── Reinstall (optional) ─────────────────────────────────────────────────────

if [[ "$REINSTALL" == true ]]; then
  echo
  info "Reinstall mode — cleaning up existing installation"
  echo

  read -rp "  ${BOLD}? Existing install directory [/opt/jeeves]:${RESET} " CLEANUP_DIR < /dev/tty
  CLEANUP_DIR="${CLEANUP_DIR:-/opt/jeeves}"

  if [[ -d "$CLEANUP_DIR" ]] && [[ -f "$CLEANUP_DIR/docker-compose.yml" ]]; then
    echo
    echo "  ${RED}${BOLD}WARNING: This will destroy ALL Jeeves data (workspace, sessions, Tailscale state)${RESET}"
    read -rp "  ${BOLD}? Type 'reinstall' to confirm:${RESET} " CONFIRM_REINSTALL < /dev/tty

    if [[ "$CONFIRM_REINSTALL" != "reinstall" ]]; then
      error "Aborted"
      exit 1
    fi

    echo
    info "Stopping containers and removing volumes + images..."
    (cd "$CLEANUP_DIR" && $COMPOSE down -v --rmi all 2>/dev/null) || true

    info "Removing install directory ($CLEANUP_DIR)..."
    if [[ -w "$CLEANUP_DIR" ]]; then
      rm -rf "$CLEANUP_DIR"
    else
      sudo rm -rf "$CLEANUP_DIR"
    fi

    success "Cleanup complete"
  else
    warn "No existing installation found at $CLEANUP_DIR — continuing with fresh install"
  fi

  echo
fi

# ─── Configuration ─────────────────────────────────────────────────────────────

echo
info "Configuration"
echo

# Telegram Bot Token
while true; do
  prompt BOT_TOKEN "Telegram Bot Token"
  [[ -n "$BOT_TOKEN" ]] && break
  error "Bot token cannot be empty"
done

# Telegram Chat ID
while true; do
  prompt CHAT_ID "Telegram Chat ID"
  if [[ "$CHAT_ID" =~ ^-?[0-9]+$ ]]; then
    break
  fi
  error "Chat ID must be a number (negative for group chats)"
done

# Auth method
echo
echo "  ${BOLD}? Auth method:${RESET}"
echo "    1) API key"
echo "    2) OAuth (auth.json)"
read -rp "  ${BOLD}  Choose [1/2]:${RESET} " AUTH_CHOICE < /dev/tty
echo

AUTH_METHOD="apikey"
API_KEY=""
AUTH_JSON_PATH=""

if [[ "$AUTH_CHOICE" == "2" ]]; then
  AUTH_METHOD="oauth"

  # Search common locations
  AUTH_JSON_FOUND=""
  for candidate in "./auth.json" "$HOME/auth.json"; do
    if [[ -f "$candidate" ]]; then
      AUTH_JSON_FOUND="$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"
      break
    fi
  done

  if [[ -n "$AUTH_JSON_FOUND" ]]; then
    echo "  Found auth.json at: ${BOLD}$AUTH_JSON_FOUND${RESET}"
    read -rp "  ${BOLD}? Use this file? [Y/n]:${RESET} " USE_FOUND < /dev/tty
    if [[ "${USE_FOUND,,}" != "n" ]]; then
      AUTH_JSON_PATH="$AUTH_JSON_FOUND"
    fi
  fi

  # Manual path as fallback
  if [[ -z "$AUTH_JSON_PATH" ]]; then
    while true; do
      prompt AUTH_JSON_PATH "Path to auth.json"
      if [[ -f "$AUTH_JSON_PATH" ]]; then
        AUTH_JSON_PATH="$(cd "$(dirname "$AUTH_JSON_PATH")" && pwd)/$(basename "$AUTH_JSON_PATH")"
        break
      fi
      error "File not found: $AUTH_JSON_PATH"
    done
  fi

  # Validate auth.json contains refreshToken
  if ! grep -q '"refreshToken"' "$AUTH_JSON_PATH" 2>/dev/null; then
    error "auth.json doesn't look like an OAuth credentials file (no refreshToken found)"
    exit 1
  fi

  success "Using auth.json: $AUTH_JSON_PATH"

else
  # API key
  while true; do
    prompt_secret API_KEY "Anthropic API Key"
    if [[ "$API_KEY" == sk-ant-* ]]; then
      break
    fi
    error "API key should start with sk-ant-"
  done
  success "API key accepted"
fi

# Tailscale
echo
read -rp "  ${BOLD}? Configure Tailscale? [y/N]:${RESET} " SETUP_TAILSCALE < /dev/tty
TS_AUTHKEY=""
if [[ "${SETUP_TAILSCALE,,}" == "y" ]]; then
  echo "  Get a reusable auth key from: https://login.tailscale.com/admin/settings/keys"
  while true; do
    prompt_secret TS_AUTHKEY "Tailscale Auth Key"
    [[ -n "$TS_AUTHKEY" ]] && break
    error "Auth key cannot be empty"
  done
  success "Tailscale will be configured"
fi

# OpenAI (optional — semantic memory search)
echo
read -rp "  ${BOLD}? OpenAI API Key (optional, enables semantic memory):${RESET} " OPENAI_KEY < /dev/tty

# Install directory
echo
read -rp "  ${BOLD}? Install directory [/opt/jeeves]:${RESET} " INSTALL_DIR < /dev/tty
INSTALL_DIR="${INSTALL_DIR:-/opt/jeeves}"

echo
success "Configuration complete"

# ─── Install ───────────────────────────────────────────────────────────────────

echo
info "Installing to $INSTALL_DIR"
echo

# Create directory (use sudo if needed)
if [[ -w "$(dirname "$INSTALL_DIR")" ]]; then
  mkdir -p "$INSTALL_DIR"
else
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$(id -u):$(id -g)" "$INSTALL_DIR"
fi

# Generate .env
{
  echo "TELEGRAM_BOT_TOKEN=$BOT_TOKEN"
  echo "TELEGRAM_CHAT_ID=$CHAT_ID"
  if [[ "$AUTH_METHOD" == "apikey" ]]; then
    echo "ANTHROPIC_API_KEY=$API_KEY"
  fi
  if [[ -n "$TS_AUTHKEY" ]]; then
    echo "TS_AUTHKEY=$TS_AUTHKEY"
  fi
  if [[ -n "$OPENAI_KEY" ]]; then
    echo "OPENAI_API_KEY=$OPENAI_KEY"
  fi
} > "$INSTALL_DIR/.env"
chmod 600 "$INSTALL_DIR/.env"
success "Generated .env"

# Copy auth.json if OAuth
if [[ "$AUTH_METHOD" == "oauth" ]]; then
  cp "$AUTH_JSON_PATH" "$INSTALL_DIR/auth.json"
  chmod 600 "$INSTALL_DIR/auth.json"
  success "Copied auth.json"
fi

# Generate docker-compose.yml
cat > "$INSTALL_DIR/docker-compose.yml" <<'COMPOSE_EOF'
version: '3'
services:
  jeeves:
    image: ghcr.io/eddmann/jeeves:latest
    container_name: jeeves
    restart: unless-stopped
    env_file: .env
    volumes:
      - workspace:/app/workspace
      - tailscale-state:/var/lib/tailscale
COMPOSE_EOF

# Add auth.json mount if OAuth
if [[ "$AUTH_METHOD" == "oauth" ]]; then
  sed -i.bak '/- workspace:\/app\/workspace/a\
      - ./auth.json:/app/auth.json' "$INSTALL_DIR/docker-compose.yml"
  rm -f "$INSTALL_DIR/docker-compose.yml.bak"
fi

cat >> "$INSTALL_DIR/docker-compose.yml" <<'COMPOSE_EOF'

  watchtower:
    image: containrrr/watchtower
    container_name: watchtower
    restart: unless-stopped
    environment:
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_POLL_INTERVAL=300
      - WATCHTOWER_SCOPE=jeeves
    labels:
      - com.centurylinklabs.watchtower.scope=jeeves
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock

volumes:
  workspace:
  tailscale-state:
COMPOSE_EOF

success "Generated docker-compose.yml"

# ─── Start ─────────────────────────────────────────────────────────────────────

echo
info "Starting Jeeves..."
echo

cd "$INSTALL_DIR"
$COMPOSE pull
$COMPOSE up -d

# ─── Done ──────────────────────────────────────────────────────────────────────

echo
echo "${GREEN}${BOLD}==> Jeeves is running!${RESET}"
echo
echo "  ${BOLD}Monitoring:${RESET}"
echo "    ${DIM}cd $INSTALL_DIR${RESET}"
echo "    ${DIM}$COMPOSE ps${RESET}"
echo "    ${DIM}$COMPOSE logs -f jeeves${RESET}"
echo
echo "  ${BOLD}Watchtower:${RESET}"
echo "    ${DIM}$COMPOSE logs watchtower${RESET}"
echo "    ${DIM}Auto-updates every 5 minutes from GHCR${RESET}"
if [[ -n "$TS_AUTHKEY" ]]; then
  echo
  echo "  ${BOLD}Tailscale:${RESET}"
  echo "    ${DIM}ssh root@jeeves  # from any device on your tailnet${RESET}"
fi
echo
