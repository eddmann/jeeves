import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runAgent, MAX_ITERATIONS, sanitizeForPersist, type AgentContext } from "../src/agent";
import { SessionStore } from "../src/session";
import { buildSystemPrompt } from "../src/workspace/prompt";
import { formatSkillsForPrompt } from "../src/skills/prompt";
import type { LLMResponse, LLMContentBlock, LLMMessage } from "../src/llm";
import type { ProgressUpdate } from "../src/progress";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import {
  buildLLMResponse,
  buildStubTool,
  buildSkill,
  buildWorkspaceFile,
} from "./helpers/factories";
import { buildStubAuth } from "./helpers/stub-auth";
import { MemoryIndex } from "../src/memory/index";
import { createNoOpEmbedder } from "../src/memory/embeddings";

let tmpDir: string;
let memoryIndex: MemoryIndex;

beforeEach(() => {
  tmpDir = createTempDir();
  memoryIndex = new MemoryIndex(":memory:", createNoOpEmbedder(), tmpDir);
});

afterEach(() => {
  cleanupTempDir(tmpDir);
});

function makeCtx(opts: {
  llmResponses: LLMResponse[];
  tools?: ReturnType<typeof buildStubTool>[];
  skills?: ReturnType<typeof buildSkill>[];
  workspaceFiles?: ReturnType<typeof buildWorkspaceFile>[];
}): AgentContext & { callCount: number } {
  let callCount = 0;
  const responses = [...opts.llmResponses];

  return {
    authStorage: buildStubAuth(),
    tools: opts.tools ?? [],
    skills: opts.skills ?? [],
    workspaceFiles: opts.workspaceFiles ?? [],
    sessionStore: new SessionStore(tmpDir),
    sessionKey: "test-session",
    memoryIndex,
    callLLM: async () => {
      callCount++;
      const response = responses.shift();
      if (!response) return buildLLMResponse({ text: "fallback end", stopReason: "end_turn" });
      return response;
    },
    get callCount() {
      return callCount;
    },
  };
}

describe("agent loop", () => {
  test("returns LLM text when conversation ends naturally", async () => {
    const ctx = makeCtx({
      llmResponses: [buildLLMResponse({ text: "Hello there!" })],
    });

    const result = await runAgent(ctx, "Hi");

    expect(result).toBe("Hello there!");
  });

  test("executes tool and passes result back to LLM", async () => {
    const tool = buildStubTool("bash", "command output");
    const ctx = makeCtx({
      llmResponses: [
        buildLLMResponse({
          text: "",
          toolCalls: [{ id: "tc1", name: "bash", input: { command: "ls" } }],
          stopReason: "tool_use",
        }),
        buildLLMResponse({ text: "I ran the command" }),
      ],
      tools: [tool],
    });

    const result = await runAgent(ctx, "list files");

    expect(result).toBe("I ran the command");
    expect(tool.calls.length).toBe(1);
    expect(tool.calls[0]).toEqual({ command: "ls" });
  });

  test("executes multiple tool calls in a single response", async () => {
    const bashTool = buildStubTool("bash", "bash output");
    const readTool = buildStubTool("read", "file content");
    const ctx = makeCtx({
      llmResponses: [
        buildLLMResponse({
          text: "",
          toolCalls: [
            { id: "tc1", name: "bash", input: { command: "ls" } },
            { id: "tc2", name: "read", input: { path: "/tmp/x" } },
          ],
          stopReason: "tool_use",
        }),
        buildLLMResponse({ text: "Both done" }),
      ],
      tools: [bashTool, readTool],
    });

    const result = await runAgent(ctx, "do both");

    expect(result).toBe("Both done");
    expect(bashTool.calls.length).toBe(1);
    expect(readTool.calls.length).toBe(1);
  });

  test("loops through multiple LLM iterations", async () => {
    const tool = buildStubTool("bash", "ok");
    const ctx = makeCtx({
      llmResponses: [
        buildLLMResponse({
          text: "",
          toolCalls: [{ id: "t1", name: "bash", input: {} }],
          stopReason: "tool_use",
        }),
        buildLLMResponse({
          text: "",
          toolCalls: [{ id: "t2", name: "bash", input: {} }],
          stopReason: "tool_use",
        }),
        buildLLMResponse({ text: "All done" }),
      ],
      tools: [tool],
    });

    const result = await runAgent(ctx, "multi step");

    expect(result).toBe("All done");
    expect(ctx.callCount).toBe(3);
  });

  test("stops at the iteration limit and returns sentinel string", async () => {
    const tool = buildStubTool("bash", "ok");
    const neverEnding = buildLLMResponse({
      text: "",
      toolCalls: [{ id: "tc", name: "bash", input: {} }],
      stopReason: "tool_use",
    });
    const ctx = makeCtx({
      llmResponses: Array(MAX_ITERATIONS + 5).fill(neverEnding),
      tools: [tool],
    });

    const result = await runAgent(ctx, "infinite loop");

    expect(result).toBe("(Agent reached maximum iterations)");
    expect(ctx.callCount).toBe(MAX_ITERATIONS);
  });

  test("returns graceful message for unknown tool names", async () => {
    const ctx = makeCtx({
      llmResponses: [
        buildLLMResponse({
          text: "",
          toolCalls: [{ id: "tc1", name: "nonexistent", input: {} }],
          stopReason: "tool_use",
        }),
        buildLLMResponse({ text: "handled" }),
      ],
    });

    const result = await runAgent(ctx, "use unknown tool");

    expect(result).toBe("handled");
  });

  test("recovers from tool execution errors", async () => {
    const errorTool = buildStubTool("bash", "");
    errorTool.execute = async () => {
      throw new Error("command failed");
    };
    const ctx = makeCtx({
      llmResponses: [
        buildLLMResponse({
          text: "",
          toolCalls: [{ id: "tc1", name: "bash", input: {} }],
          stopReason: "tool_use",
        }),
        buildLLMResponse({ text: "handled error" }),
      ],
      tools: [errorTool],
    });

    const result = await runAgent(ctx, "fail");

    expect(result).toBe("handled error");
  });

  test("persists session history after completion", async () => {
    const sessionStore = new SessionStore(tmpDir);
    const ctx = makeCtx({ llmResponses: [buildLLMResponse({ text: "saved" })] });
    ctx.sessionStore = sessionStore;

    await runAgent(ctx, "save me");
    const saved = sessionStore.get("test-session");

    expect(saved.length).toBeGreaterThan(0);
  });

  test("includes prior session history in LLM context", async () => {
    const sessionStore = new SessionStore(tmpDir);
    sessionStore.append("history-session", [
      { role: "user", content: "previous" },
      { role: "assistant", content: "context" },
    ]);
    let receivedMessageCount = 0;
    const ctx: AgentContext = {
      authStorage: buildStubAuth(),
      tools: [],
      skills: [],
      workspaceFiles: [],
      sessionStore,
      sessionKey: "history-session",
      memoryIndex,
      callLLM: async (opts) => {
        receivedMessageCount = opts.messages.length;
        return buildLLMResponse({ text: "with context" });
      },
    };

    await runAgent(ctx, "new message");

    expect(receivedMessageCount).toBe(3);
  });

  test("reports thinking progress during LLM calls", async () => {
    const ctx = makeCtx({ llmResponses: [buildLLMResponse({ text: "done" })] });
    const progress: ProgressUpdate[] = [];

    await runAgent(ctx, "think", async (u) => {
      progress.push(u);
    });

    expect(progress.some((p) => p.type === "thinking")).toBe(true);
  });

  test("reports tool execution progress", async () => {
    const tool = buildStubTool("bash", "ok");
    const ctx = makeCtx({
      llmResponses: [
        buildLLMResponse({
          text: "",
          toolCalls: [{ id: "tc1", name: "bash", input: {} }],
          stopReason: "tool_use",
        }),
        buildLLMResponse({ text: "done" }),
      ],
      tools: [tool],
    });
    const progress: ProgressUpdate[] = [];

    await runAgent(ctx, "run tool", async (u) => {
      progress.push(u);
    });

    expect(progress.some((p) => p.type === "tool_running")).toBe(true);
  });

  test("builds system prompt from workspace files and skills", async () => {
    let receivedSystem = "";
    const ctx: AgentContext = {
      authStorage: buildStubAuth(),
      tools: [],
      skills: [buildSkill({ name: "deploy", description: "Deploy" })],
      workspaceFiles: [buildWorkspaceFile("MEMORY.md", "Remember this")],
      sessionStore: new SessionStore(tmpDir),
      sessionKey: "test-session",
      memoryIndex,
      callLLM: async (opts) => {
        receivedSystem = opts.systemPrompt;
        return buildLLMResponse({ text: "ok" });
      },
    };

    await runAgent(ctx, "hi");

    expect(receivedSystem).toContain("Jeeves");
    expect(receivedSystem).toContain("Remember this");
    expect(receivedSystem).toContain("deploy");
  });

  test("passes tools to LLM in expected format", async () => {
    let receivedTools: unknown[] = [];
    const tool = buildStubTool("bash", "ok");
    const ctx: AgentContext = {
      authStorage: buildStubAuth(),
      tools: [tool],
      skills: [],
      workspaceFiles: [],
      sessionStore: new SessionStore(tmpDir),
      sessionKey: "test-session",
      memoryIndex,
      callLLM: async (opts) => {
        receivedTools = opts.tools;
        return buildLLMResponse({ text: "ok" });
      },
    };

    await runAgent(ctx, "hi");

    expect(receivedTools.length).toBe(1);
    expect((receivedTools[0] as { name: string }).name).toBe("bash");
  });

  test("handles responses with both text and tool calls", async () => {
    const tool = buildStubTool("bash", "output");
    const ctx = makeCtx({
      llmResponses: [
        buildLLMResponse({
          text: "Let me check...",
          toolCalls: [{ id: "tc1", name: "bash", input: { command: "ls" } }],
          stopReason: "tool_use",
        }),
        buildLLMResponse({ text: "Here's what I found" }),
      ],
      tools: [tool],
    });

    const result = await runAgent(ctx, "check");

    expect(result).toBe("Here's what I found");
    expect(tool.calls.length).toBe(1);
  });

  test("accepts LLMContentBlock[] as userMessage with image blocks", async () => {
    let receivedMessageCount = 0;
    let hadImageBlock = false;
    const ctx: AgentContext = {
      authStorage: buildStubAuth(),
      tools: [],
      skills: [],
      workspaceFiles: [],
      sessionStore: new SessionStore(tmpDir),
      sessionKey: "test-session",
      memoryIndex,
      callLLM: async (opts) => {
        receivedMessageCount = opts.messages.length;
        // Check if any message contains an image block
        for (const msg of opts.messages) {
          if (typeof msg.content === "string") continue;
          if (msg.content.some((b) => b.type === "image")) hadImageBlock = true;
        }
        return buildLLMResponse({ text: "I see the image" });
      },
    };

    const content: LLMContentBlock[] = [
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: "abc123" },
      },
      { type: "text", text: "What is this?" },
    ];

    const result = await runAgent(ctx, content);

    expect(result).toBe("I see the image");
    expect(receivedMessageCount).toBe(1);
    expect(hadImageBlock).toBe(true);
  });

  test("sanitizes image blocks before persisting to session", async () => {
    const sessionStore = new SessionStore(tmpDir);
    const ctx: AgentContext = {
      authStorage: buildStubAuth(),
      tools: [],
      skills: [],
      workspaceFiles: [],
      sessionStore,
      sessionKey: "sanitize-session",
      memoryIndex,
      callLLM: async () => buildLLMResponse({ text: "ok" }),
    };

    const content: LLMContentBlock[] = [
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: "huge-base64-data" },
      },
      { type: "text", text: "describe this" },
    ];

    await runAgent(ctx, content);

    // Read back persisted session — image blocks should be replaced with [Image]
    const saved = sessionStore.get("sanitize-session");
    for (const msg of saved) {
      if (typeof msg.content === "string") continue;
      for (const block of msg.content) {
        expect(block.type).not.toBe("image");
      }
    }
    // Verify the [Image] placeholder is present
    const userMsg = saved.find((m) => m.role === "user" && Array.isArray(m.content));
    expect(userMsg).toBeDefined();
    const textBlocks = (userMsg!.content as LLMContentBlock[]).filter((b) => b.type === "text");
    expect(textBlocks.some((b) => (b as { text: string }).text === "[Image]")).toBe(true);
  });
});

describe("sanitizeForPersist", () => {
  test("replaces image blocks with [Image] text blocks", () => {
    const messages: LLMMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: "abc" },
          },
          { type: "text", text: "caption" },
        ],
      },
    ];

    const result = sanitizeForPersist(messages);

    const blocks = result[0].content as LLMContentBlock[];
    expect(blocks[0]).toEqual({ type: "text", text: "[Image]" });
    expect(blocks[1]).toEqual({ type: "text", text: "caption" });
  });

  test("passes through string content unchanged", () => {
    const messages: LLMMessage[] = [{ role: "user", content: "hello" }];

    const result = sanitizeForPersist(messages);

    expect(result[0].content).toBe("hello");
  });

  test("passes through non-image blocks unchanged", () => {
    const messages: LLMMessage[] = [
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
      },
    ];

    const result = sanitizeForPersist(messages);

    const blocks = result[0].content as LLMContentBlock[];
    expect(blocks[0].type).toBe("tool_result");
  });
});

describe("system prompt building", () => {
  test("includes base identity text", () => {
    const prompt = buildSystemPrompt({ workspaceFiles: [], skillsPrompt: "", isOAuth: false });

    expect(prompt).toContain("You are Jeeves");
    expect(prompt).toContain("personal AI assistant");
  });

  test("includes tools section listing all 5 tools", () => {
    const prompt = buildSystemPrompt({ workspaceFiles: [], skillsPrompt: "", isOAuth: false });

    expect(prompt).toContain("## Tools");
    expect(prompt).toContain("bash");
    expect(prompt).toContain("read");
    expect(prompt).toContain("write");
    expect(prompt).toContain("webfetch");
    expect(prompt).toContain("cron");
  });

  test("includes workspace file content under project context", () => {
    const files = [buildWorkspaceFile("MEMORY.md", "Remember this")];

    const prompt = buildSystemPrompt({ workspaceFiles: files, skillsPrompt: "", isOAuth: false });

    expect(prompt).toContain("## Project Context");
    expect(prompt).toContain("MEMORY.md");
    expect(prompt).toContain("Remember this");
  });

  test("includes skills formatted as XML when present", () => {
    const skills = [buildSkill({ name: "deploy", description: "Deploy the app" })];
    const skillsPrompt = formatSkillsForPrompt(skills);

    const prompt = buildSystemPrompt({ workspaceFiles: [], skillsPrompt, isOAuth: false });

    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>deploy</name>");
    expect(prompt).toContain("<description>Deploy the app</description>");
  });

  test("omits skills section when no skills exist", () => {
    const skillsPrompt = formatSkillsForPrompt([]);

    const prompt = buildSystemPrompt({ workspaceFiles: [], skillsPrompt, isOAuth: false });

    expect(prompt).not.toContain("<available_skills>");
    expect(prompt).not.toContain("## Skills");
  });

  test("includes self-extension instructions", () => {
    const prompt = buildSystemPrompt({ workspaceFiles: [], skillsPrompt: "", isOAuth: false });

    expect(prompt).toContain("## Self-Extension");
    expect(prompt).toContain("SKILL.md");
  });

  test("includes skill file location in formatted output", () => {
    const skills = [
      buildSkill({ name: "my-skill", filePath: "/workspace/skills/my-skill/SKILL.md" }),
    ];

    const result = formatSkillsForPrompt(skills);

    expect(result).toContain("<location>/workspace/skills/my-skill/SKILL.md</location>");
  });
});
