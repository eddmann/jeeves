# Testing

## Running Tests

```bash
make test          # run all tests
make test/watch    # watch mode
```

The Makefile targets use the explicit `tests/` path. Running bare `bun test` will pick up foreign test files from `tmp/openclaw/` and crash.

## Philosophy

We follow the **classical (Detroit) school** of testing. The unit under test is a unit of **behavior**, not a unit of code. A single test might exercise multiple functions or classes working together — that's fine and expected.

**Test through the public API.** Tests interact with the system the same way callers would. We don't test private methods or assert on internal state.

**Real objects over mocks.** We prefer stubs and fakes over mocks, and use test doubles only for true external boundaries: the Anthropic API, `globalThis.fetch`, the system clock, the filesystem (when we need to control it). Internal collaborators are never replaced with test doubles — if something is hard to test without mocking internals, that's a signal to reconsider the design.

**Focus on behaviors that matter.** We don't chase coverage metrics. Tests exist where they catch real bugs and document real behaviors. Thin glue code (like the grammY bot wiring in `createTelegramChannel`) is not tested because we'd be testing our mocks, not our code.

## Test Structure

Every test follows **Arrange-Act-Assert** with blank line separation:

```typescript
test("expired OAuth triggers refresh", async () => {
  // Arrange
  const store = new AuthStorage(authPath(), stubRefresh({ accessToken: "refreshed" }));
  await store.saveOAuth({
    accessToken: "expired",
    refreshToken: "rt",
    expiresAt: Date.now() + 1000,
  });

  // Act
  setSystemTime(new Date(Date.now() + 2000));
  const cred = await store.getCredential();

  // Assert
  expect(cred).toMatchObject({ type: "oauth", accessToken: "refreshed" });
});
```

Multiple assertions in a single test are fine when they verify different facets of the same behavior.

## Test Organization

Tests are organized by **feature/behavior**, not by file structure:

| Test file                    | What it covers                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `agent.test.ts`              | Agent loop: LLM calls, tool execution, iteration limits, session persistence, progress reporting, system prompt building |
| `session.test.ts`            | Conversation persistence: save/load, truncation, orphaned tool_result cleanup, filesystem safety                         |
| `heartbeat.test.ts`          | Periodic check-ins: active hours, content detection, HEARTBEAT_OK suppression, deduplication                             |
| `scheduling.test.ts`         | Cron scheduler + cron tool: job CRUD, schedule types (at/every/cron), execution, persistence, tool interface             |
| `workspace.test.ts`          | Workspace files: loading, truncation, initialization, template seeding, .env loading                                     |
| `skills.test.ts`             | Skill discovery: loading, validation (name, description, directory match, format), overrides                             |
| `telegram.test.ts`           | Pure functions: markdown-to-HTML conversion, message splitting, progress formatting, reply context                       |
| `stealth.test.ts`            | OAuth stealth: tool name remapping (both directions), headers, system prompt prefix                                      |
| `bash-tool.test.ts`          | Bash tool: command execution, exit codes, stderr, working directory, timeout                                             |
| `read-file-tool.test.ts`     | Read tool: line numbering, path resolution, error handling                                                               |
| `write-file-tool.test.ts`    | Write tool: content writing, directory creation, overwrite, error handling                                               |
| `web-fetch-tool.test.ts`     | Web fetch: HTTP errors, HTML extraction, non-HTML passthrough, truncation, Readability fallback                          |
| `auth-storage.test.ts`       | Auth storage: credential CRUD, OAuth refresh (with DI), env var fallback, file permissions, logout                       |
| `edit-file-tool.test.ts`     | Edit tool: find-and-replace, no-match handling, multi-occurrence                                                         |
| `web-search-tool.test.ts`    | Web search: query execution, result parsing, count limits, error handling                                                |
| `memory-index.test.ts`       | MemoryIndex: file indexing, sync, chunk storage, stale cleanup                                                           |
| `memory-hybrid.test.ts`      | Hybrid search: vector + keyword merge, weighting, score normalization                                                    |
| `memory-search-tool.test.ts` | Memory search tool: query interface, result formatting                                                                   |
| `embeddings.test.ts`         | Embeddings: OpenAI API calls, batching, no-op embedder                                                                   |
| `compaction.test.ts`         | Compaction: token estimation, summarization, orphan repair, flush/compact thresholds                                     |
| `agent-lock.test.ts`         | Agent mutex: serialization, timeout, lock release                                                                        |
| `transcribe.test.ts`         | Transcription: Whisper API wrapper, file format handling                                                                 |

## Test Doubles Used

We use precise terminology for test doubles (see table below). "Mock" is not a catch-all.

| Double type | Where used                            | What it replaces                                                         |
| ----------- | ------------------------------------- | ------------------------------------------------------------------------ |
| **Stub**    | `AgentContext.callLLM`                | Anthropic API — returns scripted `LLMResponse` sequences                 |
| **Stub**    | `globalThis.fetch` in web-fetch tests | Network calls — returns canned `Response` objects                        |
| **Stub**    | `AuthStorage._refreshToken`           | OAuth token refresh endpoint — returns canned tokens or throws           |
| **Stub**    | `HeartbeatRunner.runAgent`            | Agent execution — returns canned strings                                 |
| **Spy**     | `HeartbeatRunner.sendToChannel`       | Telegram sending — records calls                                         |
| **Spy**     | `buildStubTool().calls`               | Tool execution — records inputs while returning canned output            |
| **Fake**    | `buildStubAuth()`                     | AuthStorage — in-memory credential store with no file I/O                |
| **Real**    | Temp directories                      | Filesystem — tests create real files in `os.tmpdir()` and clean up after |

We never mock types we don't own (grammY's `Bot`, Anthropic's `Anthropic` client, `croner`'s `Cron`). Where we need to isolate from external services, we inject our own abstractions and stub those.

## Dependency Injection Pattern

External dependencies are made injectable via optional constructor parameters or optional interface fields, with production implementations as defaults:

```typescript
// Constructor parameter with default (AuthStorage)
constructor(
  private authPath: string = join(process.cwd(), "auth.json"),
  private _refreshToken: typeof refreshAnthropicToken = refreshAnthropicToken,
)

// Optional interface field with fallback (AgentContext)
interface AgentContext {
  callLLM?: typeof callLLM;  // defaults to imported callLLM in agent.ts
}
```

The defaults mean production code constructs objects normally (`new AuthStorage(path)`). Tests inject stubs where they need control over external behavior. This keeps the DI minimal — no frameworks, no containers, just function parameters.

## Patterns and Conventions

### Temp Directory Lifecycle

Every test file that touches the filesystem uses the shared helper:

```typescript
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";

let tmpDir: string;
beforeEach(() => {
  tmpDir = createTempDir();
});
afterEach(() => {
  cleanupTempDir(tmpDir);
});
```

This creates an isolated temp directory per test and removes it after. Tests are fully independent — no shared mutable state.

### System Clock Control

Bun's `setSystemTime()` controls `Date.now()` and `new Date()`. Always reset it in `afterEach`:

```typescript
afterEach(() => {
  setSystemTime();
}); // restores real time
```

Note: `setSystemTime` does **not** affect `setTimeout`/`setInterval` timing. We don't test timer-based behavior directly — instead we call methods like `runner.runOnce()` or `scheduler.runJob()` and assert on outcomes.

### Environment Variable Isolation

Tests that touch `process.env` save and restore values:

```typescript
let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  else delete process.env.ANTHROPIC_API_KEY;
});
```

### Factory Functions

`tests/helpers/factories.ts` provides builders for common test objects:

| Factory                             | Produces                                              |
| ----------------------------------- | ----------------------------------------------------- |
| `buildLLMResponse(overrides?)`      | `LLMResponse` with sensible defaults                  |
| `buildStubTool(name, result)`       | `Tool` that records calls and returns a canned result |
| `buildSkill(overrides?)`            | `Skill` with defaults                                 |
| `buildWorkspaceFile(name, content)` | `WorkspaceFile`                                       |
| `buildCronJob(overrides?)`          | `CronJob` with defaults                               |
| `buildUserMessage(text)`            | LLM user message                                      |
| `buildAssistantMessage(text)`       | LLM assistant message                                 |
| `buildToolResultMessage(results)`   | LLM tool result message                               |

These follow the **builder pattern** — provide sensible defaults so tests only specify what's relevant to their scenario.

### `buildStubAuth()`

`tests/helpers/stub-auth.ts` provides a minimal fake `AuthStorage` that returns canned credentials without touching the filesystem. Used in agent tests where auth isn't the behavior under test.

## What We Don't Test (and Why)

**`createTelegramChannel`** — The grammY bot wiring is thin glue: construct a Bot, register handlers, start polling. Mocking grammY's `Bot` class would mean testing our mocks. The pure functions it uses (`markdownToTelegramHTML`, `splitMessage`, `formatProgress`) are tested thoroughly.

**`callLLM`** — The Anthropic SDK wrapper makes real API calls with streaming. Testing it would require either hitting the real API (slow, flaky, costs money) or mocking the SDK deeply. Instead, we inject a stub `callLLM` into the agent loop and test the orchestration.

**`loginAnthropic`** — The OAuth PKCE flow talks to Anthropic's auth endpoints. Can't be meaningfully tested without real credentials.

**`src/index.ts` `main()`** — The composition root wires everything together. It's where all the real dependencies are assembled. Testing it would be an end-to-end test requiring Telegram tokens, Anthropic credentials, etc.

**Logger** — The logger is a no-op when `logDir` is null (its default state). In tests, it silently drops all writes. No test setup needed, no assertions on log output.

## Bun Test Specifics

- Import from `"bun:test"` — same API shape as Jest/Vitest (`describe`, `test`, `expect`, `beforeEach`, `afterEach`)
- `setSystemTime(date)` mocks `Date.now()` and `new Date()` (but not timer functions)
- `setSystemTime()` with no argument restores real time
- Test files must be in the `tests/` directory and end with `.test.ts`
- Use `make test` (which runs with the explicit `tests/` path) to avoid picking up foreign test files

## Adding New Tests

1. **Identify the behavior** you want to verify — not the function, the behavior
2. **Determine the boundary**: if it touches an external service (network, API, system clock), inject a stub. If it's internal code, use the real thing
3. **Create the test file** in `tests/` named `{feature}.test.ts`
4. **Use temp directories** for any filesystem operations
5. **Use factories** from `tests/helpers/factories.ts` for test objects
6. **Follow AAA** with blank line separation
7. **Name tests** to describe the behavior: "expired OAuth triggers refresh", not "test getCredential"
8. **Run the full suite** after: `make test`
