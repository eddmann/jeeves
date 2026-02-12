# AGENTS.md

## Project Overview

Jeeves — personal AI assistant living in Telegram. TypeScript on Bun runtime, Claude LLM via `@anthropic-ai/sdk`, Telegram via grammY. Agent loop: receive message → build system prompt → call Claude with tools → execute tool calls → repeat.

## Setup

```bash
make deps                   # install dependencies
cp .env.example .env        # fill in TELEGRAM_BOT_TOKEN + auth method
make login                  # OAuth PKCE login (interactive browser flow)
# or: make login/key        # set ANTHROPIC_API_KEY in .env
make dev                    # run src/index.ts directly
```

Workspace directory (`./workspace`) is created on first run from `src/workspace/templates/`.

## Common Commands

| Task          | Command      |
| ------------- | ------------ |
| Install + run | `make start` |
| Dev           | `make dev`   |
| Build         | `make build` |
| Test          | `make test`  |
| Lint          | `make lint`  |
| Format        | `make fmt`   |
| Auth login    | `make login` |

Run `make help` for the full list of targets.

## Code Conventions

- **Language:** TypeScript, ES2022, `strict: true`
- **Module resolution:** `"bundler"` — all imports use extensionless specifiers (`./foo` not `./foo.ts`)
- **Files:** `kebab-case.ts` for source, `SCREAMING_CASE.md` for workspace convention files
- **Exports:** Named exports (no default exports)
- **Function prefixes:** `create*` (factories), `load*` (filesystem), `build*` (assemble), `init*` (setup), `format*` (to string), `run*` (execute), `get*` (retrieve), `is*` (boolean), `save*` (persist)
- **Types:** `interface` for object shapes, `type` for unions/aliases
- **Constants:** `ALL_CAPS` with `as const`
- **Error handling:** try-catch with `err instanceof Error ? err.message : String(err)` — tools never throw to agent
- **Formatting:** Prettier — double quotes, semicolons, trailing commas, 100 char lines, 2-space indent
- **Package manager:** bun only (`bun.lock`)
- **Bun APIs:** `Bun.spawn()` for shell, `Bun.file().text()` for reads, `Bun.write()` for writes

### Architecture

```
src/index.ts             → entry point, CLI commands, composition root
src/agent.ts             → agent loop (max 25 iterations): LLM → tools → repeat
src/agent-lock.ts        → agent mutex (withAgentLock, 3-min timeout)
src/llm.ts               → Anthropic SDK wrapper, streaming, OAuth stealth mode
src/session.ts           → JSONL session store (append-only, compaction markers, rotation)
src/logger.ts            → JSONL structured logger (daily rotating)
src/heartbeat.ts         → periodic agent check-ins with dedup + active hours
src/progress.ts          → progress update formatting for Telegram
src/transcribe.ts        → OpenAI Whisper audio transcription wrapper
src/auth/                → OAuth PKCE, token storage + auto-refresh, stealth mode
src/channel/telegram.ts  → grammY bot, markdown→HTML, message splitting, photo/voice/audio
src/tools/               → tool implementations (see tool list below)
src/cron/                → cron scheduler + JSONL job persistence
src/memory/              → SQLite memory index (vector + FTS5), compaction, embeddings
src/workspace/           → convention file loading, workspace init, system prompt builder
src/skills/              → SKILL.md discovery + system prompt formatting
```

Agent tools: `bash`, `read` (read_file), `write` (write_file), `edit` (edit_file), `web_fetch`, `web_search`, `cron`, `memory_search`. All scoped to workspace directory. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed system design.

### Skills

SKILL.md files with YAML frontmatter (`name`, `description`). Bundled in `skills/`, user overrides in `workspace/skills/`. Directory name must match `name` field. Names: `/^[a-z0-9-]+$/`, max 64 chars.

### Workspace Convention Files

Loaded from `workspace/` into system prompt: `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `MEMORY.md`, `HEARTBEAT.md`. Max 20,000 chars per file (truncated 70% head / 20% tail).

## Tests & CI

- **Framework:** Bun's built-in test runner (`bun:test`)
- **Location:** `tests/*.test.ts`, helpers in `tests/helpers/`
- **Philosophy:** Classical (Detroit) school — behavior-focused, real objects over mocks, AAA pattern
- **Mocking:** `setSystemTime()` for clock, global `fetch` replacement, dependency injection for `callLLM`
- **CI:** GitHub Actions runs `make can-release` (lint + test) on push

See [docs/TESTING.md](docs/TESTING.md) for test factories, helpers, and detailed conventions.

## PR & Workflow Rules

- Single `main` branch, origin remote at github.com/eddmann/jeeves — direct commits, no PRs
- Commit style: conventional commits (`feat:`, `refactor:`, `fix:`)

## Security & Gotchas

- **Never commit:** `.env`, `auth.json`, `workspace/` (all gitignored)
- **OAuth stealth mode** remaps tool names via `src/auth/stealth.ts` — don't rename tools without updating the mapping
- **Agent mutex** (`withAgentLock` in `src/agent-lock.ts`) serializes all agent runs (Telegram, cron, heartbeat) — long tool executions block everything
- **Session compaction** repairs orphaned `tool_result` blocks and summarizes old messages via LLM — some tool context may be lost after compaction
- **`workspace/`** is gitignored runtime state — templates seeded from `src/workspace/templates/` on first run
- **`runAgent`** mutates the `history` array in place — if capturing messages in tests, capture `.length` not the array reference
- **`setSystemTime()`** mocks `Date.now()`/`new Date()` but NOT `setTimeout`/`setInterval`
