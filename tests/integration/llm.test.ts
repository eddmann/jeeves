/**
 * Integration tests for the OpenAI Codex backend.
 * Tests the full stack via `bun dev chat` CLI command.
 * Run via `make test-integration`.
 * Skipped automatically if no auth is configured.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import type { LLMMessage, LLMContentBlock } from "../../src/llm";

const authPath = join(process.cwd(), "auth.json");
const hasAuth = existsSync(authPath);
const workspaceDir = process.env.WORKSPACE_DIR || join(process.cwd(), "workspace");
const sessionsDir = join(workspaceDir, "sessions");

/** Run `bun dev chat <message>` and return stdout. */
async function chat(message: string): Promise<string> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", "chat", message], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LOG_LEVEL: "error" },
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`chat exited ${exitCode}: ${stderr}`);
  }
  // Strip the "> message\n\n" prefix
  const lines = stdout.split("\n");
  const prefixEnd = lines.findIndex((l, i) => i > 0 && lines[i - 1] === "");
  return lines
    .slice(prefixEnd >= 0 ? prefixEnd : 0)
    .join("\n")
    .trim();
}

/** Read the cli session JSONL and extract all tool_use blocks. */
function getSessionToolUses(): Array<{ name: string; input: Record<string, unknown> }> {
  const uses: Array<{ name: string; input: Record<string, unknown> }> = [];
  if (!existsSync(sessionsDir)) return uses;

  for (const file of readdirSync(sessionsDir)) {
    if (!file.startsWith("cli")) continue;
    const content = readFileSync(join(sessionsDir, file), "utf-8").trim();
    if (!content) continue;
    for (const line of content.split("\n")) {
      try {
        const msg = JSON.parse(line) as LLMMessage;
        if (typeof msg.content === "string" || !Array.isArray(msg.content)) continue;
        for (const block of msg.content as LLMContentBlock[]) {
          if (block.type === "tool_use") {
            uses.push({ name: block.name, input: block.input });
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  }
  return uses;
}

/** Clear the cli session between tests so tool_use checks are scoped. */
function clearSession(): void {
  if (!existsSync(sessionsDir)) return;
  for (const file of readdirSync(sessionsDir)) {
    if (file.startsWith("cli")) {
      try {
        unlinkSync(join(sessionsDir, file));
      } catch {
        // ignore
      }
    }
  }
}

describe.skipIf(!hasAuth)("CLI integration", () => {
  beforeAll(() => {
    if (!hasAuth) {
      console.warn("Skipping: no auth.json found");
    }
    clearSession();
  });

  test("basic text response", async () => {
    clearSession();
    const output = await chat("Reply with exactly: PONG");
    expect(output).toContain("PONG");
  }, 60_000);

  test("bash tool execution", async () => {
    clearSession();
    await chat("Use the bash tool to run 'echo integration-test-ok'.");

    const uses = getSessionToolUses();
    const bashCalls = uses.filter((u) => u.name === "bash");
    expect(bashCalls.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(bashCalls[0].input)).toContain("integration-test-ok");
  }, 60_000);

  test("read tool", async () => {
    clearSession();
    const cwd = process.cwd();
    await chat(`Use the read tool to read the file ${cwd}/package.json.`);

    const uses = getSessionToolUses();
    const readCalls = uses.filter((u) => u.name === "read");
    expect(readCalls.length).toBeGreaterThanOrEqual(1);
    // The model may make other read calls (e.g. skills) — check that any read targeted package.json
    const readPackageJson = readCalls.some((u) => JSON.stringify(u.input).includes("package.json"));
    expect(readPackageJson).toBe(true);
  }, 60_000);

  test("write and read tool chain", async () => {
    clearSession();
    const tag = `test-${Date.now()}`;
    await chat(
      `Use the write tool to create a file called _integration_test.txt with the content '${tag}'. Then use the read tool to read it back.`,
    );

    // Verify tool calls in session
    const uses = getSessionToolUses();
    const writeCall = uses.find((u) => u.name === "write");
    const readCall = uses.find((u) => u.name === "read");
    expect(writeCall).toBeDefined();
    expect(readCall).toBeDefined();

    // Verify the file was actually written with the right content
    const filePath = join(workspaceDir, "_integration_test.txt");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toContain(tag);
  }, 120_000);

  test("edit tool", async () => {
    clearSession();
    await chat(
      "Use the write tool to create a file called _integration_edit.txt with content 'alpha'. " +
        "Then use the edit tool to replace 'alpha' with 'beta'.",
    );

    // Verify tool calls in session
    const uses = getSessionToolUses();
    const editCall = uses.find((u) => u.name === "edit");
    expect(editCall).toBeDefined();

    // Verify the file on disk has the edited content
    const filePath = join(workspaceDir, "_integration_edit.txt");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toContain("beta");
    expect(readFileSync(filePath, "utf-8")).not.toContain("alpha");
  }, 120_000);

  test("web_fetch tool", async () => {
    clearSession();
    await chat("Use the web_fetch tool to fetch https://httpbin.org/get.");

    const uses = getSessionToolUses();
    const fetchCalls = uses.filter((u) => u.name === "web_fetch");
    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(fetchCalls[0].input)).toContain("httpbin.org");
  }, 60_000);

  test("memory_search tool", async () => {
    clearSession();
    await chat("Use the memory_search tool to search for 'jeeves'.");

    const uses = getSessionToolUses();
    const searchCalls = uses.filter((u) => u.name === "memory_search");
    expect(searchCalls.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(searchCalls[0].input)).toContain("jeeves");
  }, 60_000);

  test("multi-turn context via session", async () => {
    clearSession();
    await chat("Remember this code: ZEBRA-42");
    const output = await chat("What code did I just ask you to remember?");
    expect(output).toContain("ZEBRA-42");
  }, 120_000);

  test("system prompt includes workspace files", async () => {
    clearSession();
    const output = await chat(
      "List the filenames from your system prompt. Just the .md filenames.",
    );
    // These are always present in the workspace
    expect(output).toMatch(/SOUL|IDENTITY|MEMORY/);
  }, 60_000);

  test("skills are discoverable", async () => {
    clearSession();
    const output = await chat("List your available skill names, one per line.");
    // Check for bundled skills that definitely exist
    expect(output.toLowerCase()).toMatch(/summarise|github|plex|reminders/);
  }, 60_000);

  afterAll(() => {
    // Clean up temp files created by write/edit tests
    for (const name of ["_integration_test.txt", "_integration_edit.txt"]) {
      try {
        unlinkSync(join(workspaceDir, name));
      } catch {
        // Already gone or never created
      }
    }
    clearSession();
  });
});
