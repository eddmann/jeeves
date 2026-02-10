import { describe, test, expect } from "bun:test";
import {
  estimateMessageTokens,
  estimateHistoryTokens,
  shouldFlush,
  shouldCompact,
  buildFlushPrompt,
  repairOrphanedToolResults,
  summarizeMessages,
  compactSession,
  CONTEXT_WINDOW,
  RESERVE_FLOOR,
  SOFT_THRESHOLD,
} from "../src/memory/compaction";
import type { LLMMessage } from "../src/llm";
import {
  buildUserMessage,
  buildAssistantMessage,
  buildToolUseMessage,
  buildToolResultMessage,
  buildLLMResponse,
} from "./helpers/factories";
import { buildStubAuth } from "./helpers/stub-auth";

describe("estimateMessageTokens", () => {
  test("estimates tokens for a string message", () => {
    const msg = buildUserMessage("Hello world"); // 11 chars
    const tokens = estimateMessageTokens(msg);

    // 11 / 4 * 1.2 = 3.3, ceil = 4
    expect(tokens).toBe(4);
  });

  test("estimates tokens for a message with content blocks", () => {
    const msg: LLMMessage = {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "result text here" }],
    };
    const tokens = estimateMessageTokens(msg);

    expect(tokens).toBeGreaterThan(0);
  });

  test("estimates tokens for tool_use blocks including input", () => {
    const msg = buildToolUseMessage([
      { id: "t1", name: "bash", input: { command: "ls -la /tmp" } },
    ]);
    const tokens = estimateMessageTokens(msg);

    expect(tokens).toBeGreaterThan(0);
  });
});

describe("estimateHistoryTokens", () => {
  test("sums tokens for all messages", () => {
    const messages = [buildUserMessage("Hello"), buildAssistantMessage("Hi there")];
    const total = estimateHistoryTokens(messages);

    expect(total).toBe(estimateMessageTokens(messages[0]) + estimateMessageTokens(messages[1]));
  });

  test("returns 0 for empty history", () => {
    expect(estimateHistoryTokens([])).toBe(0);
  });
});

describe("shouldFlush", () => {
  test("returns false when well within budget", () => {
    expect(shouldFlush(100_000)).toBe(false);
  });

  test("returns true when approaching limit", () => {
    const threshold = CONTEXT_WINDOW - RESERVE_FLOOR - SOFT_THRESHOLD;
    expect(shouldFlush(threshold)).toBe(true);
    expect(shouldFlush(threshold + 1)).toBe(true);
  });

  test("returns false just below threshold", () => {
    const threshold = CONTEXT_WINDOW - RESERVE_FLOOR - SOFT_THRESHOLD;
    expect(shouldFlush(threshold - 1)).toBe(false);
  });
});

describe("shouldCompact", () => {
  test("returns false when within budget", () => {
    expect(shouldCompact(100_000)).toBe(false);
  });

  test("returns true when over limit", () => {
    const limit = CONTEXT_WINDOW - RESERVE_FLOOR;
    expect(shouldCompact(limit + 1)).toBe(true);
  });
});

describe("buildFlushPrompt", () => {
  test("includes instructions to save to memory files", () => {
    const prompt = buildFlushPrompt();

    expect(prompt).toContain("write_file");
    expect(prompt).toContain("memory/");
  });

  test("includes current date in memory file path", () => {
    const prompt = buildFlushPrompt();
    const date = new Date().toISOString().split("T")[0];

    expect(prompt).toContain(date);
  });
});

describe("repairOrphanedToolResults", () => {
  test("keeps tool_results with matching tool_use", () => {
    const messages: LLMMessage[] = [
      buildToolUseMessage([{ id: "t1", name: "bash", input: {} }]),
      buildToolResultMessage([{ tool_use_id: "t1", content: "ok" }]),
    ];

    const repaired = repairOrphanedToolResults(messages);

    expect(repaired.length).toBe(2);
  });

  test("removes orphaned tool_results", () => {
    const messages: LLMMessage[] = [
      buildToolResultMessage([{ tool_use_id: "orphan_id", content: "stale result" }]),
      buildUserMessage("hello"),
    ];

    const repaired = repairOrphanedToolResults(messages);

    // Orphaned tool_result message removed entirely, only user message remains
    expect(repaired.length).toBe(1);
    expect(repaired[0].content).toBe("hello");
  });

  test("preserves string content messages", () => {
    const messages: LLMMessage[] = [buildUserMessage("hi"), buildAssistantMessage("hello")];

    const repaired = repairOrphanedToolResults(messages);

    expect(repaired).toEqual(messages);
  });

  test("handles mixed blocks — keeps non-orphaned, removes orphaned", () => {
    const messages: LLMMessage[] = [
      buildToolUseMessage([{ id: "t1", name: "bash", input: {} }]),
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "ok" },
          { type: "tool_result", tool_use_id: "orphan", content: "stale" },
        ],
      },
    ];

    const repaired = repairOrphanedToolResults(messages);

    expect(repaired.length).toBe(2);
    const lastContent = repaired[1].content;
    expect(Array.isArray(lastContent)).toBe(true);
    expect((lastContent as Array<{ tool_use_id: string }>).length).toBe(1);
    expect((lastContent as Array<{ tool_use_id: string }>)[0].tool_use_id).toBe("t1");
  });
});

describe("summarizeMessages", () => {
  test("calls LLM and returns summary text", async () => {
    const messages = [
      buildUserMessage("What is the capital of France?"),
      buildAssistantMessage("The capital of France is Paris."),
    ];

    const summary = await summarizeMessages({
      messages,
      callLLM: async () =>
        buildLLMResponse({ text: "User asked about France's capital. Answer: Paris." }),
      authStorage: buildStubAuth(),
    });

    expect(summary).toContain("Paris");
  });

  test("falls back to simple summary on LLM failure", async () => {
    const messages = [buildUserMessage("hello"), buildAssistantMessage("hi")];

    const summary = await summarizeMessages({
      messages,
      callLLM: async () => {
        throw new Error("API error");
      },
      authStorage: buildStubAuth(),
    });

    expect(summary).toContain("2 messages");
    expect(summary).toContain("1 user");
    expect(summary).toContain("1 assistant");
  });
});

describe("compactSession", () => {
  test("returns compacted messages with summary prepended", async () => {
    const messages: LLMMessage[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(buildUserMessage(`user message ${i}`));
      messages.push(buildAssistantMessage(`assistant reply ${i}`));
    }

    const result = await compactSession({
      messages,
      totalTokens: CONTEXT_WINDOW,
      callLLM: async () => buildLLMResponse({ text: "Summary of conversation" }),
      authStorage: buildStubAuth(),
    });

    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toContain("[Previous conversation summary]");
    expect(result.summary).toBe("Summary of conversation");
  });

  test("repairs orphaned tool_results in kept messages", async () => {
    const messages: LLMMessage[] = [
      buildUserMessage("early message"),
      buildAssistantMessage("early reply"),
      // These will be in the "kept" portion
      buildToolResultMessage([{ tool_use_id: "orphan_id", content: "no matching tool_use" }]),
      buildUserMessage("recent message"),
      buildAssistantMessage("recent reply"),
    ];

    const result = await compactSession({
      messages,
      totalTokens: CONTEXT_WINDOW,
      callLLM: async () => buildLLMResponse({ text: "Summary" }),
      authStorage: buildStubAuth(),
    });

    // Orphaned tool_result should have been removed
    for (const msg of result.messages) {
      if (typeof msg.content === "string") continue;
      for (const block of msg.content) {
        if (block.type === "tool_result") {
          expect(block.tool_use_id).not.toBe("orphan_id");
        }
      }
    }
  });
});
