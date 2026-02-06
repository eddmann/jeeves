import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SessionStore, MAX_MESSAGES } from "../src/session";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import {
  buildUserMessage,
  buildAssistantMessage,
  buildToolResultMessage,
} from "./helpers/factories";
import { writeFileSync } from "fs";
import { join } from "path";

let tmpDir: string;
let store: SessionStore;

beforeEach(() => {
  tmpDir = createTempDir();
  store = new SessionStore(tmpDir);
});

afterEach(() => {
  cleanupTempDir(tmpDir);
});

describe("conversation persistence", () => {
  test("returns empty history for new conversation", () => {
    const loaded = store.get("nonexistent");

    expect(loaded).toEqual([]);
  });

  test("persists and retrieves conversation history", () => {
    const messages = [buildUserMessage("hi"), buildAssistantMessage("hello")];

    store.set("test", messages);
    const loaded = store.get("test");

    expect(loaded).toEqual(messages);
  });

  test("truncates sessions exceeding the message limit", () => {
    const messages = [];
    for (let i = 0; i < MAX_MESSAGES + 10; i++) {
      messages.push(buildUserMessage(`msg ${i}`));
      messages.push(buildAssistantMessage(`reply ${i}`));
    }

    store.set("big", messages);
    const loaded = store.get("big");

    expect(loaded.length).toBeLessThanOrEqual(MAX_MESSAGES);
  });

  test("ensures truncated history starts at a clean conversation boundary", () => {
    const messages = [];
    for (let i = 0; i < MAX_MESSAGES / 2; i++) {
      messages.push(buildUserMessage(`msg ${i}`));
      messages.push(buildAssistantMessage(`reply ${i}`));
    }
    messages.push(buildToolResultMessage([{ tool_use_id: "id1", content: "result" }]));
    messages.push(buildAssistantMessage("after tool"));

    store.set("tools", messages);
    const loaded = store.get("tools");

    expect(loaded.length).toBeGreaterThan(0);
    const first = loaded[0];
    const isOrphanedToolResult =
      Array.isArray(first.content) &&
      first.content.length > 0 &&
      first.content[0].type === "tool_result";
    expect(isOrphanedToolResult).toBe(false);
  });

  test("preserves full history at the message limit", () => {
    const messages = [];
    for (let i = 0; i < MAX_MESSAGES / 2; i++) {
      messages.push(buildUserMessage(`msg ${i}`));
      messages.push(buildAssistantMessage(`reply ${i}`));
    }
    expect(messages.length).toBe(MAX_MESSAGES);

    store.set("exact", messages);
    const loaded = store.get("exact");

    expect(loaded.length).toBe(MAX_MESSAGES);
  });

  test("sanitizes special characters in session keys for filesystem safety", () => {
    const messages = [buildUserMessage("hi")];

    store.set("chat:123/456", messages);
    const loaded = store.get("chat:123/456");

    expect(loaded).toEqual(messages);
  });

  test("returns empty history for corrupted session file", () => {
    writeFileSync(join(tmpDir, "bad.jsonl"), "not valid json\n", "utf-8");

    const loaded = store.get("bad");

    expect(loaded).toEqual([]);
  });

  test("returns empty history for empty session file", () => {
    writeFileSync(join(tmpDir, "empty.jsonl"), "", "utf-8");

    const loaded = store.get("empty");

    expect(loaded).toEqual([]);
  });

  test("creates sessions directory if it does not exist", () => {
    const nested = join(tmpDir, "nested", "sessions");
    const nestedStore = new SessionStore(nested);

    nestedStore.set("test", [buildUserMessage("hi")]);

    expect(nestedStore.get("test")).toEqual([buildUserMessage("hi")]);
  });
});
