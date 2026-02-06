# Architecture

Jeeves is a personal AI assistant that lives in Telegram. A user sends a message, the agent loop calls Claude with tools, and the reply comes back. Everything else — sessions, heartbeats, cron, skills — exists to support that core interaction.

## Runtime and Build

- **Bun** as runtime, bundler, test runner, and package manager
- **TypeScript** with `strict: true`, `ES2022` target, `moduleResolution: "bundler"`
- Import specifiers are **extensionless** (`./foo` not `./foo.ts`) — this is a Bun bundler convention; the tsconfig `moduleResolution: "bundler"` makes it work
- No compilation step for dev — `make dev` executes `src/index.ts` directly
- Production builds via `make build` (bundles to `dist/`)

## System Overview

```
┌──────────────────────────────────────────────────────┐
│                    src/index.ts                       │
│              (entry point + wiring)                   │
│                                                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Telegram  │  │ Heartbeat │  │  Cron Scheduler  │  │
│  │ Channel   │  │  Runner   │  │                  │  │
│  └─────┬─────┘  └─────┬─────┘  └────────┬─────────┘  │
│        │              │                  │            │
│        └──────────────┼──────────────────┘            │
│                       │                               │
│                 withAgentLock()                        │
│                       │                               │
│              ┌────────▼────────┐                      │
│              │   Agent Loop    │                      │
│              │  (src/agent.ts) │                      │
│              └────────┬────────┘                      │
│                       │                               │
│         ┌─────────────┼──────────────┐                │
│         ▼             ▼              ▼                │
│   ┌──────────┐  ┌──────────┐  ┌───────────┐          │
│   │   LLM    │  │  Tools   │  │  Session   │          │
│   │(src/llm) │  │ (5 tools)│  │   Store    │          │
│   └──────────┘  └──────────┘  └───────────┘          │
└──────────────────────────────────────────────────────┘
```

Three triggers feed messages into the agent: Telegram messages from the user, the heartbeat timer, and cron jobs firing. All three go through the **agent mutex** (`withAgentLock`) — only one agent run at a time. This is a deliberate simplification; there's no concurrent access to sessions or workspace files to worry about.

## Entry Point (`src/index.ts`)

The `main()` function is the composition root. It:

1. Parses CLI commands (`login`, `login --api-key`, `logout`, `status`)
2. Initializes the workspace directory structure and loads `.env`
3. Creates all shared dependencies: `AuthStorage`, `SessionStore`, `CronScheduler`, tools, the Telegram channel, and the `HeartbeatRunner`
4. Starts everything and registers graceful shutdown handlers

The `makeAgentContext()` helper builds an `AgentContext` for each agent run, reloading skills fresh each time (so new skills are picked up without restart).

## Agent Loop (`src/agent.ts`)

The core of the system. Given a user message:

1. **Load history** from `SessionStore` (JSONL on disk, keyed by chat ID)
2. **Build system prompt** from workspace convention files + skills
3. **Call Claude** with the conversation history and tool definitions
4. **If Claude returns tool calls**, execute them and feed the results back — loop
5. **If Claude returns `end_turn`** or makes no tool calls, save history and return the text

The loop caps at **25 iterations** to prevent runaway agents. On hitting the cap, it returns a sentinel string.

### AgentContext

```typescript
interface AgentContext {
  authStorage: AuthStorage;
  tools: Tool[];
  skills: Skill[];
  workspaceFiles: WorkspaceFile[];
  sessionStore: SessionStore;
  sessionKey: string;
  callLLM?: typeof callLLM;    // injectable for testing
}
```

The optional `callLLM` field is the **dependency injection seam** — tests inject a stub that returns scripted responses instead of calling the Anthropic API.

## LLM Client (`src/llm.ts`)

Wraps `@anthropic-ai/sdk` with streaming. Supports two auth modes:

- **API key mode**: straightforward `apiKey` on the Anthropic client
- **OAuth stealth mode**: uses `authToken` with special headers and tool name remapping to look like Claude Code (required for OAuth tokens from Claude Pro/Max subscriptions)

The stealth layer (`src/auth/stealth.ts`) handles:
- Custom HTTP headers mimicking Claude Code's user-agent and beta flags
- Tool name remapping: `bash` -> `Bash`, `read` -> `Read`, `webfetch` -> `WebFetch`
- A system prompt prefix identifying as Claude Code

## Tools

Five tools, all registered via `allTools()` in `src/tools/index.ts`:

| Tool | File | Factory | Description |
|------|------|---------|-------------|
| `bash` | `tools/bash.ts` | `createBashTool(workspaceDir)` | Shell command execution via `Bun.spawnSync`. Commands run in workspace dir with configurable timeout. |
| `read` | `tools/read-file.ts` | `createReadFileTool(workspaceDir)` | Read file contents with line numbers. Relative paths resolve from workspace. |
| `write` | `tools/write-file.ts` | `createWriteFileTool(workspaceDir)` | Write content to files, creating parent directories as needed. |
| `webfetch` | `tools/web-fetch.ts` | `webFetchTool` (singleton) | Fetch URLs, extract readable content using `@mozilla/readability` + `linkedom`. Non-HTML returned raw. Content truncated at 10,000 chars. |
| `cron` | `tools/cron.ts` | `createCronTool(scheduler)` | Manage scheduled jobs: add/list/remove/run/status. |

All tools implement the `Tool` interface:

```typescript
interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<string>;
}
```

Tools always return strings (never throw to the agent) — errors are caught and formatted as error messages.

## Authentication (`src/auth/`)

Dual-mode auth with priority order:

1. **OAuth tokens** from `auth.json` (auto-refreshes when expired, with file locking)
2. **API key** from `auth.json`
3. **`ANTHROPIC_API_KEY`** environment variable (fallback)

`AuthStorage` manages credentials:
- Persists to `auth.json` with `0o600` permissions
- OAuth token refresh uses `proper-lockfile` for safe concurrent access across processes
- Refresh function is injectable via constructor for testing

The OAuth PKCE flow (`src/auth/oauth.ts`) handles initial login against Anthropic's endpoints. The refresh function (`refreshAnthropicToken`) handles token renewal.

## Sessions (`src/session.ts`)

JSONL files in `workspace/sessions/`, keyed by a sanitized identifier (e.g., `telegram_12345`).

- **Max 50 messages** per session, auto-truncated keeping the most recent
- Truncation skips forward past orphaned `tool_result` messages to maintain a clean conversation boundary
- Session keys are sanitized for filesystem safety (special chars replaced with `_`)

## Heartbeat (`src/heartbeat.ts`)

Periodic agent check-ins at a configurable interval (default 30 min):

1. Skip if outside active hours (configurable, supports midnight-wrapping ranges)
2. Skip if `HEARTBEAT.md` doesn't exist or contains only headings/whitespace
3. Run the agent with a standard prompt asking it to follow `HEARTBEAT.md` instructions
4. Suppress `HEARTBEAT_OK` responses (nothing to report)
5. Deduplicate identical responses within 24 hours
6. Send anything else to the Telegram channel

## Cron Scheduler (`src/cron/`)

Single-timer scheduler supporting three schedule types:

- **`at`**: one-time execution at an ISO 8601 date
- **`every`**: recurring at a fixed interval (milliseconds)
- **`cron`**: standard cron expressions via the `croner` library (with timezone support)

Jobs persist to `workspace/cron/jobs.json` with atomic writes (write to `.tmp`, then rename). The scheduler uses a single `setTimeout` arm-and-tick pattern — it computes the soonest due job and sets one timer.

Jobs can be `deleteAfterRun` (for one-shot `at` schedules) or recurring. Execution status (`ok`/`error`) is tracked per job.

## Workspace

The `workspace/` directory is the agent's persistent state directory (gitignored). Structure:

```
workspace/
├── .env              # workspace secrets (loaded at startup, won't override existing env)
├── SOUL.md           # personality/identity
├── IDENTITY.md       # who the agent is
├── USER.md           # info about the user
├── TOOLS.md          # tool usage guidance
├── MEMORY.md         # persistent memory
├── HEARTBEAT.md      # heartbeat instructions
├── AGENTS.md         # agent behavior instructions
├── skills/           # user-defined skills (override bundled)
├── sessions/         # JSONL conversation history
├── logs/             # JSONL structured logs (daily rotation)
├── cron/             # job persistence (jobs.json)
└── memory/           # daily memory files
```

### Convention Files

Seven `SCREAMING_CASE.md` files loaded from workspace at startup and injected into every system prompt. Max 20,000 chars per file, truncated with a 70% head / 20% tail strategy preserving the most important content.

### Initialization

On first run, `initWorkspace()` creates the directory structure and seeds convention files from `src/workspace/templates/`. Existing files are never overwritten.

## Skills

Skills are `SKILL.md` files with YAML frontmatter, discovered recursively from `skills/` (bundled) and `workspace/skills/` (user). Workspace skills override bundled ones by name.

Validation rules:
- Must have `name` and `description` in frontmatter
- Name must match parent directory name
- Names: lowercase alphanumeric + hyphens, max 64 chars
- Invalid skills are silently skipped (logged as warnings)

Skills are listed in the system prompt as XML blocks. The agent reads the full `SKILL.md` via the `read` tool when it needs detailed instructions for a skill.

## Telegram Channel (`src/channel/telegram.ts`)

Built on grammY with long polling. Provides:

- **Message handling**: receives text messages, routes through agent mutex, sends formatted replies
- **Markdown -> Telegram HTML**: converts markdown to Telegram's subset of HTML (bold, italic, code, links, headers)
- **Message splitting**: chunks messages at Telegram's 4096-char limit, preferring newline > space > hard split
- **Progress updates**: shows typing indicator and status messages ("Thinking...", "Running command") during agent runs, suppressed for the first 5 seconds
- **Per-chat mutex**: prevents concurrent agent runs for the same chat

## Logger (`src/logger.ts`)

JSONL structured logger writing to daily rotating files (`workspace/logs/YYYY-MM-DD.jsonl`). Module-level singleton initialized via `initLogger()`. Log levels: `debug`, `info`, `warn`, `error`. No console output — the logger is file-only. When `logDir` is null (default pre-init state), all writes are silently dropped.

## Progress Updates (`src/progress.ts`)

Formats agent iteration progress for display in Telegram:
- Thinking indicators with step numbers
- Tool-specific labels ("Running command", "Reading file", etc.)
- Multi-tool suffixes ("Reading file (2/3)")

## Data Flow: User Message to Response

```
1. User sends "check the weather" in Telegram
2. grammY handler receives it, acquires agent mutex
3. makeAgentContext() builds context with fresh skills
4. runAgent() loads session history from disk
5. System prompt assembled: base identity + tools + skills + workspace files
6. Claude called with history + system prompt + tool definitions
7. Claude responds: tool_use[bash("curl wttr.in")]
8. bash tool executes the command, returns stdout
9. Tool result appended to history, Claude called again
10. Claude responds: end_turn["It's sunny and 72F"]
11. Session history saved to disk
12. Response formatted as Telegram HTML and sent
13. Agent mutex released
```

## Key Design Decisions

**Agent mutex over concurrency.** A single promise-based lock serializes all agent runs. This eliminates race conditions on sessions and workspace files at the cost of throughput. Acceptable for a personal assistant with one user.

**JSONL for sessions and logs.** Append-friendly, human-readable, trivially parseable. Sessions are read in full on each agent run and rewritten on save.

**Stealth mode for OAuth.** OAuth tokens from Claude Pro/Max require requests that look like they come from Claude Code. The stealth layer handles this transparently — the rest of the codebase doesn't know about it.

**Tools always return strings.** No structured output, no exceptions reaching the agent. Errors are formatted as error messages. This keeps the agent loop simple and the LLM can reason about errors naturally.

**Skills are lazy-loaded.** The system prompt lists skill names and descriptions. The agent reads the full `SKILL.md` only when it decides to use a skill. This keeps the system prompt concise.

**Convention files as system prompt injection.** Workspace files are the primary mechanism for customizing the agent's behavior, personality, and knowledge. They're loaded once at startup and included in every LLM call.
