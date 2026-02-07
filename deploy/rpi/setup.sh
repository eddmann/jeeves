#!/usr/bin/env bash
set -euo pipefail

# ─── Colors ────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput &>/dev/null; then
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_URL="https://downloads.raspberrypi.org/raspios_lite_arm64_latest"
IMAGE_PATH="/tmp/raspios_lite_arm64_latest.img.xz"
CLEANUP_FILES=()

cleanup() {
  for f in "${CLEANUP_FILES[@]}"; do
    rm -f "$f"
  done
}
trap cleanup EXIT

info()    { echo "${CYAN}==>${RESET} ${BOLD}$*${RESET}"; }
warn()    { echo "${YELLOW}⚠  $*${RESET}"; }
error()   { echo "${RED}✘  $*${RESET}" >&2; }
success() { echo "${GREEN}✔  $*${RESET}"; }

prompt() {
  local var="$1" label="$2"
  local value
  read -rp "  ${BOLD}? ${label}:${RESET} " value
  eval "$var=\$value"
}

prompt_secret() {
  local var="$1" label="$2"
  local value
  read -rsp "  ${BOLD}? ${label}:${RESET} " value
  echo
  eval "$var=\$value"
}

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)      error "Unsupported OS: $(uname -s)"; exit 1 ;;
  esac
}

OS=$(detect_os)

# ─── Step 1: Configuration ────────────────────────────────────────────────────

echo
echo "${BOLD}Jeeves Raspberry Pi Setup${RESET}"
echo "${DIM}─────────────────────────${RESET}"
echo
info "Step 1 — Configuration"
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

# Hostname
read -rp "  ${BOLD}? Hostname [jeeves]:${RESET} " PI_HOSTNAME
PI_HOSTNAME="${PI_HOSTNAME:-jeeves}"

# WiFi
read -rp "  ${BOLD}? Configure WiFi? [y/N]:${RESET} " SETUP_WIFI
WIFI_SSID=""
WIFI_PASSWORD=""
if [[ "${SETUP_WIFI,,}" == "y" ]]; then
  while true; do
    prompt WIFI_SSID "WiFi SSID"
    [[ -n "$WIFI_SSID" ]] && break
    error "SSID cannot be empty"
  done
  prompt_secret WIFI_PASSWORD "WiFi password"
fi

# SSH
echo
echo "  SSH will be enabled for headless access."
while true; do
  prompt_secret SSH_PASSWORD "SSH password for user 'jeeves'"
  [[ -n "$SSH_PASSWORD" ]] && break
  error "Password cannot be empty"
done

# Auth method
echo
echo "  ${BOLD}? Auth method:${RESET}"
echo "    1) API key"
echo "    2) OAuth (auth.json)"
read -rp "  ${BOLD}  Choose [1/2]:${RESET} " AUTH_CHOICE
echo

AUTH_METHOD="apikey"
API_KEY=""
AUTH_JSON_PATH=""

if [[ "$AUTH_CHOICE" == "2" ]]; then
  AUTH_METHOD="oauth"

  # Search for auth.json
  AUTH_JSON_FOUND=""
  for candidate in "$PROJECT_ROOT/auth.json" "./auth.json"; do
    if [[ -f "$candidate" ]]; then
      AUTH_JSON_FOUND="$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"
      break
    fi
  done

  if [[ -n "$AUTH_JSON_FOUND" ]]; then
    echo "  Found auth.json at: ${BOLD}$AUTH_JSON_FOUND${RESET}"
    read -rp "  ${BOLD}? Use this file? [Y/n]:${RESET} " USE_FOUND
    if [[ "${USE_FOUND,,}" != "n" ]]; then
      AUTH_JSON_PATH="$AUTH_JSON_FOUND"
    fi
  fi

  # If not found or user declined, offer make login
  if [[ -z "$AUTH_JSON_PATH" ]]; then
    if [[ -f "$PROJECT_ROOT/Makefile" ]]; then
      read -rp "  ${BOLD}? No auth.json found. Run OAuth login now? [Y/n]:${RESET} " RUN_LOGIN
      if [[ "${RUN_LOGIN,,}" != "n" ]]; then
        echo
        info "Running OAuth login (this will open a browser)..."
        if (cd "$PROJECT_ROOT" && make login); then
          if [[ -f "$PROJECT_ROOT/auth.json" ]]; then
            AUTH_JSON_PATH="$PROJECT_ROOT/auth.json"
            success "auth.json created"
          else
            error "make login completed but auth.json not found"
          fi
        else
          error "make login failed"
        fi
      fi
    fi
  fi

  # Manual path as fallback
  if [[ -z "$AUTH_JSON_PATH" ]]; then
    while true; do
      prompt AUTH_JSON_PATH "Path to auth.json"
      if [[ -f "$AUTH_JSON_PATH" ]]; then
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
read -rp "  ${BOLD}? Configure Tailscale? [y/N]:${RESET} " SETUP_TAILSCALE
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

echo
success "Configuration complete"

# ─── Step 2: Flash SD card ────────────────────────────────────────────────────

echo
info "Step 2 — Flash SD card"
echo

# Detect removable devices
list_devices() {
  if [[ "$OS" == "macos" ]]; then
    diskutil list external 2>/dev/null | grep -E "^/dev/disk" | while read -r line; do
      local dev
      dev=$(echo "$line" | awk '{print $1}')
      local size
      size=$(diskutil info "$dev" 2>/dev/null | grep "Disk Size" | sed 's/.*: *//' | cut -d'(' -f1 | xargs)
      echo "$dev ($size)"
    done
  else
    lsblk -d -n -o NAME,SIZE,RM,TYPE 2>/dev/null | awk '$3==1 && $4=="disk" {print "/dev/"$1" ("$2")"}'
  fi
}

echo "  Detecting removable devices..."
echo
DEVICES=()
while IFS= read -r line; do
  [[ -n "$line" ]] && DEVICES+=("$line")
done < <(list_devices)

if [[ ${#DEVICES[@]} -gt 0 ]]; then
  for i in "${!DEVICES[@]}"; do
    echo "    $((i+1))) ${DEVICES[$i]}"
  done
  echo "    $((${#DEVICES[@]}+1))) Enter device path manually"
  echo
  read -rp "  ${BOLD}? Select device [1-$((${#DEVICES[@]}+1))]:${RESET} " DEV_CHOICE

  if [[ "$DEV_CHOICE" -le "${#DEVICES[@]}" ]] 2>/dev/null; then
    DEVICE=$(echo "${DEVICES[$((DEV_CHOICE-1))]}" | awk '{print $1}')
  else
    prompt DEVICE "Device path (e.g. /dev/disk2)"
  fi
else
  warn "No removable devices detected"
  prompt DEVICE "Device path (e.g. /dev/disk2 or /dev/sdb)"
fi

# Validate block device
if [[ ! -e "$DEVICE" ]]; then
  error "Device not found: $DEVICE"
  exit 1
fi

# Confirm destructive operation
DEVICE_NAME=$(basename "$DEVICE")
echo
echo "  ${RED}${BOLD}WARNING: ALL DATA ON $DEVICE WILL BE ERASED${RESET}"
echo
read -rp "  ${BOLD}? Type '${DEVICE_NAME}' to confirm:${RESET} " CONFIRM_DEVICE

if [[ "$CONFIRM_DEVICE" != "$DEVICE_NAME" ]]; then
  error "Device name mismatch — aborting"
  exit 1
fi

# Download image
echo
if [[ -f "$IMAGE_PATH" ]]; then
  echo "  Found cached image at $IMAGE_PATH"
  read -rp "  ${BOLD}? Use cached image? [Y/n]:${RESET} " USE_CACHED
  if [[ "${USE_CACHED,,}" == "n" ]]; then
    rm -f "$IMAGE_PATH"
  fi
fi

if [[ ! -f "$IMAGE_PATH" ]]; then
  info "Downloading Raspberry Pi OS Lite (64-bit)..."
  curl -fSL --progress-bar -o "$IMAGE_PATH" "$IMAGE_URL"
  success "Download complete"
fi

# Unmount device
echo
info "Unmounting $DEVICE..."
if [[ "$OS" == "macos" ]]; then
  diskutil unmountDisk "$DEVICE" 2>/dev/null || true
else
  for part in "${DEVICE}"*; do
    umount "$part" 2>/dev/null || true
  done
fi

# Flash
info "Flashing image to $DEVICE (this will take a few minutes)..."
if [[ "$OS" == "macos" ]]; then
  RAW_DEVICE="${DEVICE/disk/rdisk}"
  xzcat "$IMAGE_PATH" | sudo dd of="$RAW_DEVICE" bs=1m 2>&1
else
  xzcat "$IMAGE_PATH" | sudo dd of="$DEVICE" bs=4M oflag=dsync status=progress 2>&1
fi
sync
success "Flash complete"

# Mount boot partition
echo
info "Mounting boot partition..."
BOOT_MOUNT=""

if [[ "$OS" == "macos" ]]; then
  sleep 2
  diskutil mountDisk "$DEVICE" 2>/dev/null || true
  sleep 2
  if [[ -d "/Volumes/bootfs" ]]; then
    BOOT_MOUNT="/Volumes/bootfs"
  else
    # Try waiting a bit longer
    sleep 3
    if [[ -d "/Volumes/bootfs" ]]; then
      BOOT_MOUNT="/Volumes/bootfs"
    else
      error "Boot partition not found at /Volumes/bootfs"
      echo "  Mount it manually and re-run, or copy files by hand."
      exit 1
    fi
  fi
else
  # Detect first partition
  if [[ "$DEVICE" =~ [0-9]$ ]]; then
    PART="${DEVICE}p1"
  else
    PART="${DEVICE}1"
  fi
  BOOT_MOUNT=$(mktemp -d)
  CLEANUP_FILES+=("$BOOT_MOUNT")
  sudo mount "$PART" "$BOOT_MOUNT"
fi

success "Boot partition mounted at $BOOT_MOUNT"

# ─── Step 3: Copy files ───────────────────────────────────────────────────────

echo
info "Step 3 — Copy files to boot partition"
echo

# Generate env file
ENV_FILE=$(mktemp)
CLEANUP_FILES+=("$ENV_FILE")

{
  echo "TELEGRAM_BOT_TOKEN=$BOT_TOKEN"
  echo "TELEGRAM_CHAT_ID=$CHAT_ID"
  if [[ "$AUTH_METHOD" == "apikey" ]]; then
    echo "ANTHROPIC_API_KEY=$API_KEY"
  fi
  if [[ -n "$TS_AUTHKEY" ]]; then
    echo "TS_AUTHKEY=$TS_AUTHKEY"
  fi
} > "$ENV_FILE"

# Generate user-data with hostname + SSH user
USER_DATA=$(mktemp)
CLEANUP_FILES+=("$USER_DATA")

cat > "$USER_DATA" <<USERDATA
#cloud-config
hostname: $PI_HOSTNAME

users:
  - name: jeeves
    plain_text_passwd: $SSH_PASSWORD
    lock_passwd: false
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    groups: docker

ssh_pwauth: true

packages:
  - docker.io
  - docker-compose-v2

runcmd:
  - systemctl enable --now docker
  - mkdir -p /opt/jeeves
  - cp /boot/firmware/docker-compose.yml /opt/jeeves/
  - cp /boot/firmware/env /opt/jeeves/.env
  - test -f /boot/firmware/auth.json && cp /boot/firmware/auth.json /opt/jeeves/
  - cd /opt/jeeves && docker compose up -d
USERDATA

# Prepare docker-compose.yml (uncomment auth.json mount if OAuth)
COMPOSE_FILE=$(mktemp)
CLEANUP_FILES+=("$COMPOSE_FILE")
cp "$SCRIPT_DIR/docker-compose.yml" "$COMPOSE_FILE"

if [[ "$AUTH_METHOD" == "oauth" ]]; then
  sed -i.bak 's|# - ./auth.json:/app/auth.json|- ./auth.json:/app/auth.json|' "$COMPOSE_FILE"
  rm -f "${COMPOSE_FILE}.bak"
fi

# Copy files
sudo cp "$COMPOSE_FILE" "$BOOT_MOUNT/docker-compose.yml"
success "Copied docker-compose.yml"

sudo cp "$ENV_FILE" "$BOOT_MOUNT/env"
success "Copied env"

sudo cp "$USER_DATA" "$BOOT_MOUNT/user-data"
success "Copied user-data"

# Enable SSH
sudo touch "$BOOT_MOUNT/ssh"
success "Enabled SSH"

# WiFi config
if [[ -n "$WIFI_SSID" ]]; then
  NETCFG=$(mktemp)
  CLEANUP_FILES+=("$NETCFG")
  cat > "$NETCFG" <<NETCONFIG
version: 2
wifis:
  wlan0:
    dhcp4: true
    optional: true
    access-points:
      "$WIFI_SSID":
        password: "$WIFI_PASSWORD"
NETCONFIG
  sudo cp "$NETCFG" "$BOOT_MOUNT/network-config"
  success "Copied WiFi config"
fi

if [[ "$AUTH_METHOD" == "oauth" ]]; then
  sudo cp "$AUTH_JSON_PATH" "$BOOT_MOUNT/auth.json"
  success "Copied auth.json"
fi

# Eject
echo
info "Ejecting SD card..."
if [[ "$OS" == "macos" ]]; then
  diskutil eject "$DEVICE" 2>/dev/null || true
else
  sudo umount "$BOOT_MOUNT" 2>/dev/null || true
  sudo eject "$DEVICE" 2>/dev/null || true
fi
success "SD card ejected"

# ─── Done ──────────────────────────────────────────────────────────────────────

echo
echo "${GREEN}${BOLD}==> Done!${RESET} Insert the SD card into your Pi and power on."
echo "${DIM}    Cloud-init will install Docker and start Jeeves on first boot.${RESET}"
echo
