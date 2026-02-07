# Raspberry Pi Deployment

Run Jeeves on a Raspberry Pi with automatic updates. Flash an SD card, boot, and cloud-init handles the rest.

## Requirements

| Item                                                         | Notes                                       |
| ------------------------------------------------------------ | ------------------------------------------- |
| Raspberry Pi 3B+, 4, or 5                                    | 64-bit OS required (`arm64`)                |
| MicroSD card                                                 | 8 GB+                                       |
| [Raspberry Pi Imager](https://www.raspberrypi.com/software/) | For manual flash only (not needed with `setup.sh`) |
| Network                                                      | Ethernet or Wi-Fi (configured during flash) |

## Setup

### Quick setup

Run the setup script to flash and configure the SD card in one step:

    bash setup.sh

It will prompt for your Telegram and Anthropic credentials, detect your SD card,
flash Raspberry Pi OS, and copy all deployment files. Then just insert and boot.

To do it manually instead, follow the steps below.

### 1. Flash the SD card

Open Raspberry Pi Imager and flash **Raspberry Pi OS Lite (64-bit)**. In the settings dialog:

- Set hostname (e.g. `jeeves`)
- Configure Wi-Fi if not using Ethernet
- Enable SSH and set a password or SSH key

### 2. Configure auth

**API key (simple):** Copy `env.example` to `env` and fill in your tokens:

```bash
cp env.example env
# edit env — set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ANTHROPIC_API_KEY
```

**OAuth (Claude Pro/Max):** Run `make login` on your laptop to generate `auth.json`, then copy it here. Your `env` file only needs `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

### 3. Copy files to boot partition

Mount the SD card's boot partition and copy the deployment files:

```bash
cp docker-compose.yml /Volumes/bootfs/
cp env /Volumes/bootfs/
cp user-data /Volumes/bootfs/

# If using OAuth:
cp auth.json /Volumes/bootfs/
```

If using OAuth, uncomment the `auth.json` volume mount in `docker-compose.yml` before copying.

> **Linux:** The boot partition mounts at `/media/$USER/bootfs` or similar.

### 4. Boot

Insert the SD card and power on. Cloud-init will:

1. Install Docker and the Compose plugin
2. Copy config files to `/opt/jeeves/`
3. Pull the Jeeves image and start the stack

First boot takes a few minutes. Jeeves will be running once cloud-init completes.

## Tailscale (Optional)

The setup script can configure a [Tailscale](https://tailscale.com/) sidecar for SSH access to the Jeeves container from any device on your tailnet. When prompted, provide a reusable auth key from the [Tailscale admin console](https://login.tailscale.com/admin/settings/keys).

For manual setup, uncomment the Tailscale blocks in `docker-compose.yml` and add `TS_AUTHKEY` to your `env` file.

Once running, SSH in with:

```bash
ssh jeeves  # from any device on your tailnet
```

## How updates work

[Watchtower](https://containrrr.dev/watchtower/) polls GHCR every 5 minutes. When a new image is pushed (on every commit to main), Watchtower pulls it and restarts Jeeves automatically. Zero-touch updates.

## Monitoring

SSH into the Pi and check on things:

```bash
ssh jeeves.local

# Service status
cd /opt/jeeves
docker compose ps

# Jeeves logs
docker compose logs -f jeeves

# Watchtower logs (update history)
docker compose logs watchtower
```

Workspace logs are inside the Docker volume at `workspace/logs/`.

## Troubleshooting

| Problem                 | Fix                                                              |
| ----------------------- | ---------------------------------------------------------------- |
| Cloud-init didn't run   | Check `/var/log/cloud-init-output.log` on the Pi                 |
| Docker not running      | `sudo systemctl status docker`                                   |
| Jeeves not starting     | `docker compose logs jeeves` — check for missing env vars        |
| Image not pulling       | Verify network connectivity: `curl -I https://ghcr.io`           |
| Watchtower not updating | `docker compose logs watchtower` — check for auth/network errors |

## File layout on the Pi

```
/opt/jeeves/
  docker-compose.yml
  .env
  auth.json          # only if using OAuth
```

The workspace volume is managed by Docker and persists across container restarts and image updates.
