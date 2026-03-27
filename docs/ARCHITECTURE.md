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
┌───────────────────────────────────────────────────────────┐
│                      src/index.ts                          │
│                (entry point + wiring)                       │
│                                                           │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐       │
│  │ Telegram  │  │ Heartbeat │  │  Cron Scheduler  │       │
│  │ Channel   │  │  Runner   │  │                  │       │
│  └─────┬─────┘  └─────┬─────┘  └────────┬─────────┘       │
│        │              │                  │                 │
│        └──────────────┼──────────────────┘                 │
│                       │                                    │
│                 withAgentLock()                             │
│                       │                                    │
│              ┌────────▼────────┐                           │
│              │   Agent Loop    │                           │
│              │  (src/agent.ts) │                           │
│              └────────┬────────┘                           │
│                       │                                    │
│      ┌────────────────┼──────────────────┐                 │
│      ▼                ▼                  ▼                 │
│ ┌──────────┐  ┌────────────┐  ┌────────────────────┐      │
│ │   LLM    │  │   Tools    │  │   Session Store    │      │
│ │(src/llm) │  │  Tools     │  │  (src/session.ts)  │      │
│ └──────────┘  └──────┬─────┘  └────────┬───────────┘      │
│                      │                 │                   │
│                      ▼                 ▼                   │
│              ┌─────────────────────────────────┐           │
│              │        Memory System            │           │
│              │       (src/memory/)             │           │
│              │                                 │           │
│              │  ┌───────────┐  ┌────────────┐  │           │
│              │  │ Compaction│  │MemoryIndex │  │           │
│              │  │ (LLM sum) │  │(SQLite+FTS)│  │           │
│              │  └───────────┘  └────────────┘  │           │
│              └─────────────────────────────────┘           │
└───────────────────────────────────────────────────────────┘
```

Three triggers feed messages into the agent: Telegram messages from the user, the heartbeat timer, and cron jobs firing. All three go through the **agent mutex** (`withAgentLock`) — only one agent run at a time. This is a deliberate simplification; there's no concurrent access to sessions or workspace files to worry about.

## Entry Point (`src/index.ts`)

The `main()` function is the composition root. It:

1. Parses CLI commands (`login`, `login --api-key`, `logout`, `status`)
2. Initializes the workspace directory structure and loads `.env`
3. Creates all shared dependencies: `AuthStorage`, `SessionStore`, `CronScheduler`, `MemoryIndex`, tools, the Telegram channel, and the `HeartbeatRunner`
4. On startup, syncs memory index and indexes existing session files
5. Starts everything and registers graceful shutdown handlers

The `makeAgentContext()` helper builds an `AgentContext` for each agent run, reloading skills and workspace files fresh each time (so updates are picked up without restart).

## Agent Loop (`src/agent.ts`)

The core of the system. Given a user message:

1. **Load history** from `SessionStore` (JSONL on disk, keyed by chat ID)
2. **Build system prompt** from current workspace files + skills
3. **Tag user input with current UTC timestamp** and append to history
4. **Call Claude** with timeout retries (up to 3 attempts total, linear backoff)
5. **If Claude returns tool calls**, execute them and feed the results back — loop
6. **When token usage crosses threshold**, run out-of-band `runFlushAndCompact()`
7. **If Claude returns `end_turn`** or makes no tool calls, persist and return text

The loop caps at **25 main iterations**. On hitting the cap, it returns a fallback sentinel message.

### AgentContext

```typescript
interface AgentContext {
  authStorage: AuthStorage;
  tools: Tool[];
  skills: Skill[];
  workspaceFiles: WorkspaceFile[];
  sessionStore: SessionStore;
  sessionKey: string;
  memoryIndex: MemoryIndex;
  callLLM?: typeof callLLM; // injectable for testing
}
```

The optional `callLLM` field is the **dependency injection seam** — tests inject a stub that returns scripted responses instead of calling the Anthropic API. `memoryIndex` provides long-term memory search and is synced after compaction.

## LLM Client (`src/llm.ts`)

Wraps `@anthropic-ai/sdk` with streaming. Supports two auth modes:

- **API key mode**: straightforward `apiKey` on the Anthropic client
- **OAuth stealth mode**: uses `authToken` with special headers and tool name remapping to look like Claude Code (required for OAuth tokens from Claude Pro/Max subscriptions)

The stealth layer (`src/auth/stealth.ts`) handles:

- Custom HTTP headers mimicking Claude Code's user-agent and beta flags
- Tool name remapping: `bash` -> `Bash`, `read` -> `Read`, `web_fetch` -> `WebFetch`
- A system prompt prefix identifying as Claude Code

## Tools

All tools registered via `allTools()` in `src/tools/index.ts`:

| Tool            | File                     | Factory                               | Description                                                                                                                               |
| --------------- | ------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `bash`          | `tools/bash.ts`          | `createBashTool(workspaceDir)`        | Shell command execution via `Bun.spawnSync`. Commands run in workspace dir with configurable timeout.                                     |
| `read`          | `tools/read-file.ts`     | `createReadFileTool(workspaceDir)`    | Read file contents with line numbers. Relative paths resolve from workspace.                                                              |
| `write`         | `tools/write-file.ts`    | `createWriteFileTool(workspaceDir)`   | Write content to files, creating parent directories as needed.                                                                            |
| `edit`          | `tools/edit-file.ts`     | `createEditFileTool(workspaceDir)`    | Find-and-replace file editing. Matches a unique string in a file and replaces it.                                                         |
| `web_fetch`     | `tools/web-fetch.ts`     | `webFetchTool` (singleton)            | Fetch URLs, extract readable content using `@mozilla/readability` + `linkedom`. Non-HTML returned raw. Content truncated at 10,000 chars. |
| `web_search`    | `tools/web-search.ts`    | `webSearchTool` (singleton)           | DuckDuckGo web search. Returns search results with titles, URLs, and snippets.                                                            |
| `cron`          | `tools/cron.ts`          | `createCronTool(scheduler)`           | Manage scheduled jobs: add/list/remove/run/status.                                                                                        |
| `memory_search` | `tools/memory-search.ts` | `createMemorySearchTool(memoryIndex)` | Hybrid search over long-term memory files and past session transcripts. Semantic + keyword with `OPENAI_API_KEY`, keyword-only without.   |
| `attach`        | `tools/attach.ts`        | `createAttachTool({ attachments })`   | Declare a file to send back to the user. Write to `outbox/` first, then attach.                                                           |

All tools implement the `Tool` interface:

```typescript
interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<string>;
}
```

Tools always return strings (never throw to the agent) — errors are caught and formatted as error messages. The `attach` tool is created per-run inside `runAgent` (not shared at startup) because it captures a per-run attachments accumulator.

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

- **Append-only**: each line is a JSON-serialized `LLMMessage`
- Session keys are sanitized for filesystem safety (special chars replaced with `_`)
- No hardcoded message cap — context management is handled by the compaction system (see below)

### Compaction Markers

When context gets too large, the agent writes a **compaction marker** (`{"@@compaction":true}`) followed by compacted messages. On load, `get()` scans backward for the last marker and returns only messages after it. Original messages are preserved above the marker for indexing and auditing.

### File Rotation

When a session file exceeds 1 MB (`ROTATION_SIZE`) after compaction, a new sequentially-numbered file is created (`test.1.jsonl`, `test.2.jsonl`, etc.). The `activePath()` method always resolves to the highest-numbered file. Old files are never modified, preserving a full history archive.

## Memory System (`src/memory/`)

The memory system provides long-term knowledge persistence and retrieval across conversations. It has two complementary parts: **compaction** (context management) and **MemoryIndex** (semantic search).

### Compaction (`src/memory/compaction.ts`)

Token-aware context management that prevents context window overflow while preserving important information.

**Token estimation**: `ceil((chars / 4) * 1.2)` — a character-count heuristic with a 20% safety margin. Handles string messages, text blocks, `tool_use` (includes serialized input), and `tool_result` blocks.

**Flush-and-compact trigger** relative to `CONTEXT_WINDOW` (200K tokens):

1. **Trigger** (~188K tokens): `shouldFlushAndCompact(totalTokens)` checks `CONTEXT_WINDOW - FLUSH_COMPACT_MARGIN`.
2. **Out-of-band flush run**: `runFlushAndCompact()` appends a pre-compaction flush prompt and runs a dedicated internal loop (up to `MAX_FLUSH_TURNS`, currently 8) where the model can call tools to persist durable memory.
3. **Immediate compaction**: after the flush sub-loop ends, `compactAndSync()` runs summarization/pruning and writes a compaction marker.
4. **Flush turn timeouts**: each flush LLM call uses the same retry policy; if retries are exhausted for a flush turn, the helper exits flush turns and compacts immediately.

Compaction internals:
- Walk backward from the end, keeping recent messages up to 50% of context window
- At least 1 message or half the history is always dropped
- Orphaned `tool_result` blocks (whose matching `tool_use` was dropped) are repaired
- Dropped messages are chunked and sent to `claude-sonnet-4-5-20250929` for summarization
- If multiple chunks, a merge pass combines partial summaries
- Fallback: if LLM fails, a stats-based summary is produced
- A synthetic `[Previous conversation summary]` user message is prepended to the kept messages

**Agent loop integration** (`src/agent.ts`):

```text
for each iteration (max 25):
  inject finalization prompt once when <= 3 iterations remain
  response = callLLMWithRetries(tools = isFinalIteration ? [] : llmTools)
  if timeout after retries:
    append pending messages
    return timeout fallback

  update totalTokens from usage
  shouldFlushAndCompactNow = shouldFlushAndCompact(totalTokens)
  append assistant message

  if end_turn or no tool calls:
    if shouldFlushAndCompactNow:
      runFlushAndCompact()   # out-of-band helper, up to MAX_FLUSH_TURNS, then compactAndSync()
    append pending messages (if any) and return final text

  execute tool calls
  append tool_result message (+ iteration warning when <= 5 remain)

  if shouldFlushAndCompactNow:
    runFlushAndCompact()
    reset token counter
    continue
```

### MemoryIndex (`src/memory/index.ts`)

SQLite-backed semantic search engine using `bun:sqlite` with hybrid vector + keyword retrieval.

**Schema**:

- **`files`**: Tracks indexed files by path, content SHA-256 hash, and mtime
- **`chunks`**: Text segments with file reference, line ranges, content hash, and optional embedding vector (stored as JSON string)
- **`chunks_fts`**: FTS5 virtual table mirroring chunk text, kept in sync via triggers

**What gets indexed**:

1. **Memory files**:
   - `MEMORY.md` = semantic memory (durable facts/preferences)
   - `workspace/memory/YYYY-MM-DD.md` = episodic daily memory entries
   - All are indexed with SHA-256 change detection
2. **Session files**: JSONL files in `workspace/sessions/`, grouped by session key. Files are numbered sequentially (`chat.jsonl` = seq 0, `chat.1.jsonl` = seq 1, etc.); the highest sequence number is the **active** session, all others are **archived**:
   - **Archived files**: indexed entirely (all content is historical)
   - **Active file with compaction marker**: only content **before** the last `@@compaction` marker is indexed — everything after is already in the LLM's context window
   - **Active file without compaction marker**: not indexed at all (entire file is in context)
3. **Stale cleanup**: both memory and session entries are removed from the index when their source files no longer exist on disk

**Sync timing**: `sync()` runs at startup and after compaction.

**Self-healing**: if embeddings fail (network timeout, API error), chunks are stored without vectors and keyword search still works. On the next sync, files with missing embeddings are re-indexed even if the content hash hasn't changed.

**Chunking**: 1,600 chars (~400 tokens) with 320-char overlap (~80 tokens), breaking on line boundaries.

**Embeddings** (`src/memory/embeddings.ts`): OpenAI `text-embedding-3-small` model, batched up to 100 texts per API call, 30s timeout with 1 retry. When `OPENAI_API_KEY` is not set, a no-op embedder is used — keyword search only.

### Hybrid Search (`src/memory/hybrid.ts`)

Two search signals merged with weighted combination:

1. **Vector search**: Cosine similarity between query embedding and all stored chunk embeddings (brute-force scan, no ANN index)
2. **Keyword search**: FTS5 with BM25 ranking. Query tokenized, lowercased, punctuation-stripped, short tokens removed, remaining AND-joined as quoted FTS5 terms

**Merging**: Default weights 70% vector / 30% keyword. When one side has no results, the other gets 100% weight. Both sides normalized to 0–1 range independently. Overlapping chunks (same chunk ID in both) get additive scores. Filtered by `minScore` (default 0.35), sorted descending, limited to `maxResults` (default 6).

### Memory Search Tool (`src/tools/memory-search.ts`)

Exposed to the LLM as the `memory_search` tool. Searches the index and returns formatted results: `[N] filePath:startLine-endLine (score% match)` with the matching text.

### Circular Data Flow

The key insight is the circular flow between sessions, compaction, and memory:

```
User message arrives
    ↓
SessionStore.get() → load working history (post-compaction)
    ↓
Agent loop runs (up to 25 main iterations)
    ↓
[Context approaching limit?]
    └─ shouldFlushAndCompact → runFlushAndCompact()
           ├─ flush sub-loop (up to MAX_FLUSH_TURNS)
           └─ compactAndSync() → write compaction marker + sync index
    ↓
SessionStore.append() → persist new messages
    ↓
[Next conversation starts]
    ├─ SessionStore.get() → compacted history with summary prefix
    └─ memory_search tool → hybrid search over all memory + session files
```

Compaction prompts the LLM to write memory files, which get indexed, which become searchable via `memory_search` in future conversations. Session files themselves are also indexed as episodic memory, so past conversations are retrievable even without explicit memory writes.

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
├── MEMORY.md         # semantic memory (durable facts/preferences)
├── HEARTBEAT.md      # heartbeat instructions
├── AGENTS.md         # agent behavior instructions
├── skills/           # user-defined skills (override bundled)
├── sessions/         # JSONL conversation history
├── logs/             # JSONL structured logs (daily rotation)
├── cron/             # job persistence (jobs.json)
├── outbox/           # agent output files (sent to user via Telegram)
└── memory/           # episodic memory files (YYYY-MM-DD.md) + index.sqlite
```

### Convention Files

Seven core `SCREAMING_CASE.md` files plus up to two most recent `memory/YYYY-MM-DD.md` episodic memory files are loaded when each agent context is created and injected into every system prompt. Max 20,000 chars per file, truncated with a 70% head / 20% tail strategy preserving the most important content.

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

- **Message handling**: receives text messages, photos, voice notes, and audio files; routes through agent mutex, sends formatted replies
- **Markdown -> Telegram HTML**: converts markdown to Telegram's subset of HTML (bold, italic, code, links, headers)
- **Message splitting**: chunks messages at Telegram's 4096-char limit, preferring newline > space > hard split
- **Progress updates**: shows typing indicator and status messages ("Thinking...", "Running command") during agent runs, suppressed for the first 5 seconds
- **Per-chat mutex**: prevents concurrent agent runs for the same chat

### Message Input Pipeline

Each Telegram message type is normalized before reaching the agent loop:

| Type          | Handler                          | Sent to agent as                                                                                                   |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Text          | `message:text`                   | Plain string                                                                                                       |
| Photo         | `message:photo`                  | `LLMContentBlock[]` — base64 image (largest resolution) + caption text                                             |
| Voice / Audio | `message:voice`, `message:audio` | Plain string — transcribed via OpenAI Whisper (`OPENAI_API_KEY` required) with `[Voice message transcript]` prefix |
| Other         | `message` (fallback)             | Rejected with "unsupported message type" reply                                                                     |

**Reply context**: When a message replies to another, `getReplyContext()` extracts the original text/caption (truncated to 300 chars) and prepends it as `[Replying to: ...]`.

### Message Output Pipeline

`runAgent` returns `AgentResult { text, attachments }`. The Telegram handler:

1. Sends the text response (markdown → HTML → chunked messages)
2. Sends each attachment via the appropriate Telegram method:

| Extension | Method | Display |
| --------- | ------ | ------- |
| jpg/jpeg/png/gif/webp | `sendPhoto` | Inline image |
| ogg | `sendVoice` | Inline voice note |
| mp3/m4a/wav/aac | `sendAudio` | Audio player |
| Everything else | `sendDocument` | File download |

The `channel.send()` method also accepts attachments, so cron jobs and heartbeats can send files too.

## Logger (`src/logger.ts`)

JSONL structured logger writing to daily rotating files (`workspace/logs/YYYY-MM-DD.jsonl`). Module-level singleton initialized via `initLogger()`. Log levels: `debug`, `info`, `warn`, `error`. No console output — the logger is file-only. When `logDir` is null (default pre-init state), all writes are silently dropped.

## Progress Updates (`src/progress.ts`)

Formats agent iteration progress for display in Telegram:

- Thinking indicators with step numbers
- Tool-specific labels ("Running command", "Reading file", etc.)
- Multi-tool suffixes ("Reading file (2/3)")

## Data Flow: User Message to Response

```
1.  User sends "check the weather" in Telegram
2.  grammY handler receives it, acquires agent mutex
3.  makeAgentContext() builds context with fresh skills + workspace files + memoryIndex
4.  runAgent() loads session history from disk (post-last-compaction-marker)
5.  System prompt assembled: base identity + skills + workspace files
6.  Claude called with history + system prompt + tool definitions
7.  Claude responds: tool_use[bash("curl wttr.in")]
8.  bash tool executes the command, returns stdout
9.  Tool result appended to history, Claude called again
10. Claude responds: end_turn["It's sunny and 72F"]
11. [If context near limit: runFlushAndCompact() runs out-of-band flush turns]
12. [Flush helper then compacts immediately: summarize + prune + re-index memory]
13. Session history saved to disk
14. Response text formatted as Telegram HTML and sent
15. Any attachments sent as photos/voice/audio/documents
16. Agent mutex released
```

## Key Design Decisions

**Agent mutex over concurrency.** A single promise-based lock serializes all agent runs. This eliminates race conditions on sessions and workspace files at the cost of throughput. Acceptable for a personal assistant with one user.

**JSONL for sessions and logs.** Append-friendly, human-readable, trivially parseable. Sessions are append-only during normal turns; compaction writes a marker plus compacted working history while preserving earlier lines.

**Stealth mode for OAuth.** OAuth tokens from Claude Pro/Max require requests that look like they come from Claude Code. The stealth layer handles this transparently — the rest of the codebase doesn't know about it.

**Tools always return strings.** No structured output, no exceptions reaching the agent. Errors are formatted as error messages. This keeps the agent loop simple and the LLM can reason about errors naturally.

**Skills are lazy-loaded.** The system prompt lists skill names and descriptions. The agent reads the full `SKILL.md` only when it decides to use a skill. This keeps the system prompt concise.

**Convention files as system prompt injection.** Workspace files are the primary mechanism for customizing the agent's behavior, personality, and knowledge. Each run reloads core convention files plus the two latest episodic memory files, and includes them in every LLM call.

**Flush-and-compact as one operation.** A token threshold triggers an out-of-band flush helper that can perform multi-turn memory persistence, then compacts immediately. This preserves context while keeping the main iteration budget stable.

**Outbox via attach tool.** The agent declares files to send by calling the `attach` tool, which accumulates paths during the run. `runAgent` returns `{ text, attachments }` and the channel layer sends each file.

**Hybrid search for memory retrieval.** Combining vector similarity (semantic) with FTS5 keyword search means queries work even without embeddings (keyword-only fallback) and catch both semantically similar and exact-match content. The brute-force vector scan is acceptable given the expected corpus size for a personal assistant.

**Memory as a circular flow.** Compaction prompts the LLM to write memory files, which get indexed and become searchable in future conversations. Session transcripts are also indexed as episodic memory. This creates a self-reinforcing knowledge base without requiring explicit user action.
