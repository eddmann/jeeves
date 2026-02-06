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

| Task | Command |
|------|---------|
| Install + run | `make start` |
| Dev | `make dev` |
| Build | `make build` |
| Test | `make test` |
| Lint | `make lint` |
| Format | `make fmt` |
| Auth login | `make login` |

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
- **Bun APIs:** `Bun.spawnSync()` for shell, `Bun.file().text()` for reads, `Bun.write()` for writes

### Architecture

```
src/index.ts             → entry point, CLI commands, composition root, agent mutex
src/agent.ts             → agent loop (max 25 iterations): LLM → tools → repeat
src/llm.ts               → Anthropic SDK wrapper, streaming, OAuth stealth mode
src/session.ts           → JSONL session store (max 50 messages)
src/logger.ts            → JSONL structured logger (daily rotating)
src/heartbeat.ts         → periodic agent check-ins with dedup + active hours
src/progress.ts          → progress update formatting for Telegram
src/auth/storage.ts      → auth.json credential storage + auto-refresh
src/auth/oauth.ts        → OAuth PKCE flow
src/auth/stealth.ts      → tool name remapping + headers for OAuth mode
src/channel/telegram.ts  → grammY bot, markdown→HTML, message splitting
src/tools/index.ts       → tool registry (Tool interface)
src/tools/bash.ts        → shell execution (Bun.spawnSync, 30s timeout)
src/tools/read-file.ts   → file reading with line numbers
src/tools/write-file.ts  → file writing with auto-mkdir
src/tools/web-fetch.ts   → HTTP fetch + Readability extraction (10k char limit)
src/tools/cron.ts        → cron job scheduling tool
src/cron/scheduler.ts    → cron job runner with setTimeout timer
src/cron/store.ts        → cron job JSONL persistence
src/workspace/loader.ts  → convention file loading, workspace init, .env loading
src/workspace/prompt.ts  → system prompt builder
src/skills/loader.ts     → SKILL.md discovery (YAML frontmatter, recursive)
src/skills/prompt.ts     → format skills for system prompt
```

Five agent tools: `bash`, `read` (read_file), `write` (write_file), `webfetch` (web_fetch), `cron`. All scoped to workspace directory.

### Skills

SKILL.md files with YAML frontmatter (`name`, `description`). Bundled in `skills/`, user overrides in `workspace/skills/`. Directory name must match `name` field. Names: `/^[a-z0-9-]+$/`, max 64 chars.

### Workspace Convention Files

Loaded from `workspace/` into system prompt: `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `MEMORY.md`, `HEARTBEAT.md`. Max 20,000 chars per file (truncated 70% head / 20% tail).

## Tests & CI

- **Framework:** Bun's built-in test runner (`bun:test`)
- **Location:** `tests/*.test.ts`
- **Helpers:** `tests/helpers/` — `factories.ts` (builders), `stub-auth.ts` (fake auth), `temp-dir.ts` (temp dir lifecycle)
- **Philosophy:** Classical (Detroit) school — behavior-focused, real objects over mocks, AAA pattern
- **Mocking:** `setSystemTime()` for clock, global `fetch` replacement, dependency injection for `callLLM`
- **Gotcha:** `setSystemTime()` mocks `Date.now()`/`new Date()` but NOT `setTimeout`/`setInterval`
- **CI:** GitHub Actions runs `make can-release` (lint + test) on push

### Test factories

```typescript
buildLLMResponse(), buildStubTool(), buildSkill(), buildWorkspaceFile(), buildCronJob()
buildUserMessage(), buildAssistantMessage(), buildToolUseMessage(), buildToolResultMessage()
```

## PR & Workflow Rules

- Single `main` branch, no remotes configured
- Commit style: conventional commits (`feat:`, `refactor:`, `fix:`)
- No PR process, no branch protection, no CODEOWNERS
- Personal project — direct commits to main

## Security & Gotchas

- **Never commit:** `.env`, `auth.json`, `workspace/` (all gitignored)
- **auth.json** stores OAuth tokens with mode `0o600` — handled by `src/auth/storage.ts`
- **Extensionless imports** — `./foo` not `./foo.ts` — requires `moduleResolution: "bundler"` in tsconfig
- **OAuth stealth mode** remaps tool names via `src/auth/stealth.ts` — don't rename tools without updating the mapping
- **Agent mutex** (`withAgentLock` in `src/index.ts`) serializes all agent runs (Telegram, cron, heartbeat) — long tool executions block everything
- **SessionStore** silently drops orphaned `tool_result` messages when truncating — history may lose context after 50 messages
- **`workspace/`** is gitignored runtime state — templates seeded from `src/workspace/templates/` on first run
- **Heartbeat** deduplicates identical responses within 24h and suppresses `HEARTBEAT_OK` replies
- **`runAgent`** mutates the `history` array in place — if capturing messages in tests, capture `.length` not the array reference
