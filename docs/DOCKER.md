# Docker

Jeeves runs in a Debian-based container with Bun, uv (Python), buns, phpx, GitHub CLI, and make. Multi-arch: `linux/amd64` and `linux/arm64`.

Pre-built images are published to `ghcr.io/eddmann/jeeves` on every push to main, tagged with `latest` and the commit SHA.

## Quick Start

```bash
docker run -d --restart unless-stopped \
  -e TELEGRAM_BOT_TOKEN=... \
  -e ANTHROPIC_API_KEY=... \
  -v jeeves-workspace:/app/workspace \
  ghcr.io/eddmann/jeeves:latest
```

Or build locally:

```bash
cp .env.example .env   # fill in TELEGRAM_BOT_TOKEN + ANTHROPIC_API_KEY
make docker/run        # build + run production
```

## Build Targets

The Dockerfile has two final targets:

| Target | Purpose                                              | CMD        |
| ------ | ---------------------------------------------------- | ---------- |
| `prod` | Bundled `dist/index.js`, copies source at build time | `make run` |
| `dev`  | Expects source bind-mounted, live reload             | `make dev` |

```bash
make docker/build      # build production image
make docker/build-dev  # build dev image
make docker/run        # build + run production
make docker/dev        # build + run dev (bind-mounts repo)
```

## Environment Variables

The Makefile targets use `--env-file .env`, but you can pass env vars however you like:

```bash
docker run -d --rm \
  -e TELEGRAM_BOT_TOKEN=... \
  -e ANTHROPIC_API_KEY=... \
  -v jeeves-workspace:/app/workspace \
  ghcr.io/eddmann/jeeves:latest
```

See `.env.example` for all available variables.

## Volumes

| Mount            | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| `/app/workspace` | Persistent state — sessions, memory, cron jobs, skills, logs |
| `/app/auth.json` | OAuth credentials (only if using OAuth instead of API key)   |
| `/app`           | Full repo bind-mount (dev target only)                       |

Production uses a named Docker volume for workspace:

```bash
docker run -d --rm \
  --env-file .env \
  -v jeeves-workspace:/app/workspace \
  ghcr.io/eddmann/jeeves:latest
```

Dev bind-mounts the repo so source changes take effect immediately:

```bash
docker run -it --rm \
  --env-file .env \
  -v $(pwd):/app \
  jeeves-dev
```

## Auth

**API key (simple):** Set `ANTHROPIC_API_KEY` in your `.env` or pass via `-e`. Nothing else needed.

**OAuth:** Run `make login` on the host first to create `auth.json`, then mount it into the container:

```bash
docker run -d --rm \
  -e TELEGRAM_BOT_TOKEN=... \
  -v $(pwd)/auth.json:/app/auth.json \
  -v jeeves-workspace:/app/workspace \
  ghcr.io/eddmann/jeeves:latest
```

Tokens are auto-refreshed at runtime and written back to the mounted file.

## Env Files

There are two `.env` files with different purposes:

| File             | Purpose                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `.env` (root)    | Jeeves config — bot token, API key, heartbeat settings. Passed to the container via `--env-file` or `-e` flags. |
| `workspace/.env` | Skill secrets — API keys/tokens the agent uses at runtime (Strava, Plex, etc.)                                  |

The workspace `.env` lives inside the workspace volume and is created automatically on first run. Values in it never override existing env vars.

## Logs

Logs are written as JSONL to `workspace/logs/YYYY-MM-DD.jsonl` (daily rotating). Since `workspace/` is a volume, logs persist across container restarts.

To tail today's logs:

```bash
docker exec jeeves cat workspace/logs/$(date +%Y-%m-%d).jsonl
```

Set `LOG_LEVEL` to control verbosity (`debug`, `info`, `warn`, `error`).

## What's in the Image

The `base` stage installs:

- **Bun** — JS/TS runtime (from base image)
- **uv** — Python package manager (installs Python on demand)
- **buns** — TypeScript script runner with inline dependencies
- **phpx** — PHP script runner with inline dependencies
- **GitHub CLI** (`gh`) — for the GitHub skill
- **curl, git, jq, make, unzip** — general-purpose tools

## Multi-Arch Build

CI automatically builds and pushes multi-arch images (`linux/amd64`, `linux/arm64`) to GHCR via `docker/build-push-action` with Buildx and QEMU emulation.

To build locally:

```bash
docker buildx build --platform linux/amd64,linux/arm64 --target prod -t jeeves .
```

All bundled tools (Bun, uv, buns, phpx, gh) have ARM builds.
