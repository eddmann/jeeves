<p align="center">
  <img src="docs/logo.png" alt="Jeeves" width="200">
</p>

<h3 align="center"><em>Just ask Jeeves...</em></h3>

---

A personal AI assistant that lives in Telegram. You send a message, Claude figures out what to do — run commands, read/write files, fetch web pages, schedule tasks — and replies. Conversations persist across restarts. The agent can extend itself by writing new skills and updating its own memory.

## Why

Inspired by [OpenClaw](https://openclaw.ai/), I wanted to peel back what was under the hood and build my own from scratch. Jeeves makes deliberate tradeoffs for simplicity: Anthropic-only (no provider abstraction), Telegram-only (no multi-channel), one user at a time (mutex over concurrency). The result is a small TypeScript codebase that's easy to read and easy to modify.

## Quick Start

Clone the repo — the agent can read its own source, understand how it's built, and modify itself. Very meta.

```bash
git clone https://github.com/eddmann/jeeves.git
cd jeeves
make deps                  # install dependencies
make login                 # OAuth via Claude Pro/Max
# or: make login/key       # API key login
```

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in your environment or workspace `.env`, then:

```bash
make dev
```

Message your bot on Telegram. It responds.

## How It Works

```
You (Telegram) → grammY → Agent Loop → Claude + Tools → Reply
```

The agent loop calls Claude with conversation history and five tools (`bash`, `read`, `write`, `webfetch`, `cron`). Claude calls tools, results feed back — up to 25 iterations per message. A heartbeat system checks in periodically, and a cron scheduler handles timed jobs.

For the full system design, see [docs/architecture.md](docs/architecture.md).

## Workspace

On first run, Jeeves creates a `workspace/` directory. Convention files (`SOUL.md`, `MEMORY.md`, `HEARTBEAT.md`, etc.) are injected into every system prompt — edit them to shape how Jeeves behaves. The agent reads these each session and can update them itself.

Skills are `SKILL.md` files with YAML frontmatter. Ask the agent to create new ones, or drop them in `workspace/skills/`.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token (required) |
| `TELEGRAM_CHAT_ID` | — | Chat ID for cron/heartbeat output |
| `ANTHROPIC_API_KEY` | — | API key (alternative to OAuth login) |
| `WORKSPACE_DIR` | `./workspace` | Workspace root |
| `HEARTBEAT_INTERVAL_MINUTES` | `30` | Minutes between heartbeat checks |
| `HEARTBEAT_ACTIVE_START` / `_END` | `08:00` / `23:00` | Active hours window |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Testing

```bash
make test
```

Classical school, real objects over mocks. See [docs/TESTING.md](docs/TESTING.md).

## Commands

Run `make help` for the full list. Key targets:

```
make dev            Run the bot
make login          OAuth login (Claude Pro/Max)
make login/key      API key login
make logout         Clear saved credentials
make status         Show auth, workspace, skills info
make test           Run all tests
make lint           Run ESLint
make fmt            Format code
```

## License

[MIT](LICENSE) — Edd Mann, 2026
