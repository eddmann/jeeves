# Jeeves

![Jeeves](docs/header.png)

Your personal butler, resident in Telegram. Text, photos, or voice — Jeeves attends to the matter and replies. He never forgets a conversation and picks up new skills as the situation demands.

## Why

Inspired by [OpenClaw](https://openclaw.ai/), I wanted to peel back what was under the hood and build my own from scratch. Jeeves makes deliberate tradeoffs for simplicity: single LLM provider (OpenAI via ChatGPT Codex), Telegram-only (no multi-channel), one user at a time (mutex over concurrency). The result is a small TypeScript codebase that's easy to read and easy to modify.

## Quick Start

Jeeves can read his own source, understand how he's built, and modify himself. Very meta.

**Docker (recommended):**

```bash
docker run -d --restart unless-stopped \
  -e TELEGRAM_BOT_TOKEN=... \
  -e TELEGRAM_CHAT_ID=... \
  -v $(pwd)/auth.json:/app/auth.json \
  -v jeeves-workspace:/app/workspace \
  ghcr.io/eddmann/jeeves:latest
```

**Local:**

```bash
git clone https://github.com/eddmann/jeeves.git
cd jeeves
make deps             # install dependencies
make login            # OAuth via ChatGPT Plus/Pro
```

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in your environment or workspace `.env`, then:

```bash
make dev
```

Message your bot on Telegram. It responds. See [docs/DOCKER.md](docs/DOCKER.md) for full container setup.

## How It Works

```
You (Telegram) → grammY → Agent Loop → GPT-5.4 + Tools → Reply
```

The agent loop calls GPT-5.4 (via the ChatGPT Codex backend) with conversation history and tools (`bash`, `read`, `write`, `edit`, `web_fetch`, `web_search`, `cron`, `memory_search`). The model calls tools, results feed back — up to 25 main iterations per message, with timeout retries and graceful fallback if retries are exhausted. A heartbeat system checks in periodically, and a cron scheduler handles timed jobs.

Long-term memory is backed by a SQLite index with hybrid search (FTS5 keyword + optional OpenAI vector embeddings). `MEMORY.md` acts as semantic memory (durable facts/preferences), while `memory/YYYY-MM-DD.md` files capture episodic daily memory. Past conversation transcripts are also treated as episodic memory and indexed for recall. When context approaches the limit, the agent runs an out-of-band flush+compact helper: it asks the model to persist durable memory, then immediately compacts old messages via LLM summarization. Past conversations and memory files are searchable across sessions via the `memory_search` tool.

For the full system design, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Workspace

On first run, Jeeves creates a `workspace/` directory. Convention files (`SOUL.md`, `MEMORY.md`, `HEARTBEAT.md`, etc.) are injected into every system prompt, plus the two most recent `memory/YYYY-MM-DD.md` episodic files. Edit them to shape how Jeeves behaves; the agent reloads them each run and can update them itself.

Skills are `SKILL.md` files with YAML frontmatter. Ask the agent to create new ones, or drop them in `workspace/skills/`.

## Configuration

| Variable                          | Default           | Description                                          |
| --------------------------------- | ----------------- | ---------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`              | —                 | Telegram bot token (required)                        |
| `TELEGRAM_CHAT_ID`                | —                 | Chat ID for cron/heartbeat output                    |
| `WORKSPACE_DIR`                   | `./workspace`     | Workspace root                                       |
| `HEARTBEAT_INTERVAL_MINUTES`      | `30`              | Minutes between heartbeat checks                     |
| `HEARTBEAT_ACTIVE_START` / `_END` | `08:00` / `23:00` | Active hours window                                  |
| `OPENAI_API_KEY`                  | —                 | Semantic memory search + Whisper voice transcription |
| `LOG_LEVEL`                       | `info`            | `debug` / `info` / `warn` / `error`                  |

## Docker

The recommended way to run Jeeves. Pre-built multi-arch images (`linux/amd64`, `linux/arm64`) are [published to GHCR](https://ghcr.io/eddmann/jeeves) on every push to main. Or build locally:

```bash
make docker/run    # build + run production
make docker/dev    # build + run dev (bind-mounts repo)
```

See [docs/DOCKER.md](docs/DOCKER.md) for volumes, auth, env vars, and logs. For Raspberry Pi deployment with auto-updates, see [`deploy/rpi/`](deploy/rpi/).

## Testing

```bash
make test
```

Classical school, real objects over mocks. See [docs/TESTING.md](docs/TESTING.md).

## Commands

Run `make help` for the full list. Key targets:

```
make dev            Run the bot
make login          OAuth login (ChatGPT Plus/Pro)
make logout         Clear saved credentials
make status         Show auth, workspace, skills info
make test           Run all tests
make test/integration  Run integration tests (requires auth)
make lint           Run ESLint
make fmt            Format code
make docker/run     Build + run production container
make docker/dev     Build + run dev container
```

## License

[MIT](LICENSE) — Edd Mann, 2026
