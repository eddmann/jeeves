import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SessionStore, ROTATION_SIZE } from "../src/session";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import { buildUserMessage, buildAssistantMessage } from "./helpers/factories";
import { existsSync, readFileSync, writeFileSync } from "fs";
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

describe("append and load", () => {
  test("returns empty history for new conversation", () => {
    expect(store.get("nonexistent")).toEqual([]);
  });

  test("appends and retrieves messages", () => {
    const messages = [buildUserMessage("hi"), buildAssistantMessage("hello")];

    store.append("test", messages);
    const loaded = store.get("test");

    expect(loaded).toEqual(messages);
  });

  test("accumulates messages across multiple appends", () => {
    store.append("test", [buildUserMessage("first")]);
    store.append("test", [buildAssistantMessage("reply")]);
    store.append("test", [buildUserMessage("second")]);

    const loaded = store.get("test");

    expect(loaded.length).toBe(3);
    expect(loaded[0].content as string).toBe("first");
    expect(loaded[2].content as string).toBe("second");
  });

  test("skips append for empty message array", () => {
    store.append("test", []);

    expect(existsSync(join(tmpDir, "test.jsonl"))).toBe(false);
  });

  test("sanitizes special characters in session keys", () => {
    store.append("chat:123/456", [buildUserMessage("hi")]);
    const loaded = store.get("chat:123/456");

    expect(loaded).toEqual([buildUserMessage("hi")]);
  });

  test("getPath returns the session file path", () => {
    const path = store.getPath("my-session");

    expect(path).toContain("my-session.jsonl");
    expect(path).toContain(tmpDir);
  });
});

describe("compaction marker", () => {
  test("get returns only messages after the last compaction marker", () => {
    store.append("test", [buildUserMessage("old msg 1"), buildAssistantMessage("old reply 1")]);
    store.compact("test", [
      buildUserMessage("[Previous conversation summary]\nSummary here"),
      buildUserMessage("recent msg"),
      buildAssistantMessage("recent reply"),
    ]);

    const loaded = store.get("test");

    expect(loaded.length).toBe(3);
    expect(loaded[0].content as string).toContain("Summary here");
    expect(loaded[1].content as string).toBe("recent msg");
  });

  test("preserves original messages in the file", () => {
    store.append("test", [buildUserMessage("original")]);
    store.compact("test", [buildUserMessage("compacted")]);

    const raw = readFileSync(join(tmpDir, "test.jsonl"), "utf-8");
    expect(raw).toContain("original");
    expect(raw).toContain("compacted");
  });

  test("handles multiple compactions — uses the last marker", () => {
    store.append("test", [buildUserMessage("era 1")]);
    store.compact("test", [buildUserMessage("summary 1"), buildUserMessage("era 2 msg")]);
    store.append("test", [buildAssistantMessage("era 2 reply")]);
    store.compact("test", [buildUserMessage("summary 2"), buildUserMessage("era 3 msg")]);

    const loaded = store.get("test");

    expect(loaded.length).toBe(2);
    expect(loaded[0].content as string).toContain("summary 2");
  });

  test("new messages after compaction are included in get", () => {
    store.append("test", [buildUserMessage("old")]);
    store.compact("test", [buildUserMessage("summary")]);
    store.append("test", [buildUserMessage("new msg"), buildAssistantMessage("new reply")]);

    const loaded = store.get("test");

    expect(loaded.length).toBe(3);
    expect(loaded[0].content as string).toBe("summary");
    expect(loaded[1].content as string).toBe("new msg");
  });
});

describe("edge cases", () => {
  test("returns empty for corrupted file", () => {
    writeFileSync(join(tmpDir, "bad.jsonl"), "not valid json\n", "utf-8");

    expect(store.get("bad")).toEqual([]);
  });

  test("returns empty for empty file", () => {
    writeFileSync(join(tmpDir, "empty.jsonl"), "", "utf-8");

    expect(store.get("empty")).toEqual([]);
  });

  test("creates sessions directory if it does not exist", () => {
    const nested = join(tmpDir, "nested", "sessions");
    const nestedStore = new SessionStore(nested);

    nestedStore.append("test", [buildUserMessage("hi")]);

    expect(nestedStore.get("test")).toEqual([buildUserMessage("hi")]);
  });
});

describe("rotation", () => {
  test("compacts in place when file is under threshold", () => {
    store.append("test", [buildUserMessage("old")]);
    store.compact("test", [buildUserMessage("compacted")]);

    // Should stay in the original file with a marker
    const raw = readFileSync(join(tmpDir, "test.jsonl"), "utf-8");
    expect(raw).toContain("old");
    expect(raw).toContain("@@compaction");
    expect(raw).toContain("compacted");
    expect(existsSync(join(tmpDir, "test.1.jsonl"))).toBe(false);
  });

  test("rotates to .1.jsonl when file exceeds threshold", () => {
    // Write enough data to exceed ROTATION_SIZE
    const bigMsg = buildUserMessage("x".repeat(10_000));
    const count = Math.ceil(ROTATION_SIZE / 10_000) + 1;
    for (let i = 0; i < count; i++) {
      store.append("test", [bigMsg]);
    }

    store.compact("test", [buildUserMessage("summary")]);

    // Original file should be untouched (no new content appended)
    const originalSize = readFileSync(join(tmpDir, "test.jsonl"), "utf-8").length;
    expect(originalSize).toBeGreaterThan(ROTATION_SIZE);
    expect(existsSync(join(tmpDir, "test.1.jsonl"))).toBe(true);

    // New file has only the compacted messages (no marker needed)
    const rotated = readFileSync(join(tmpDir, "test.1.jsonl"), "utf-8");
    expect(rotated).toContain("summary");
    expect(rotated).not.toContain("@@compaction");
  });

  test("get reads from highest-numbered file after rotation", () => {
    // Fill original past threshold
    const bigMsg = buildUserMessage("x".repeat(10_000));
    const count = Math.ceil(ROTATION_SIZE / 10_000) + 1;
    for (let i = 0; i < count; i++) {
      store.append("test", [bigMsg]);
    }

    store.compact("test", [buildUserMessage("summary after rotation")]);

    const loaded = store.get("test");
    expect(loaded.length).toBe(1);
    expect(loaded[0].content as string).toBe("summary after rotation");
  });

  test("append after rotation writes to the new active file", () => {
    // Fill original past threshold and rotate
    const bigMsg = buildUserMessage("x".repeat(10_000));
    const count = Math.ceil(ROTATION_SIZE / 10_000) + 1;
    for (let i = 0; i < count; i++) {
      store.append("test", [bigMsg]);
    }
    store.compact("test", [buildUserMessage("summary")]);

    // Append to the rotated file
    store.append("test", [buildUserMessage("new msg")]);

    const rotated = readFileSync(join(tmpDir, "test.1.jsonl"), "utf-8");
    expect(rotated).toContain("new msg");

    const loaded = store.get("test");
    expect(loaded.length).toBe(2);
    expect(loaded[0].content as string).toBe("summary");
    expect(loaded[1].content as string).toBe("new msg");
  });

  test("multiple rotations create sequential numbered files", () => {
    const bigMsg = buildUserMessage("x".repeat(10_000));
    const count = Math.ceil(ROTATION_SIZE / 10_000) + 1;

    // Fill original and rotate to .1
    for (let i = 0; i < count; i++) {
      store.append("test", [bigMsg]);
    }
    store.compact("test", [buildUserMessage("summary 1")]);

    // Fill .1 past threshold and rotate to .2
    for (let i = 0; i < count; i++) {
      store.append("test", [bigMsg]);
    }
    store.compact("test", [buildUserMessage("summary 2")]);

    expect(existsSync(join(tmpDir, "test.jsonl"))).toBe(true);
    expect(existsSync(join(tmpDir, "test.1.jsonl"))).toBe(true);
    expect(existsSync(join(tmpDir, "test.2.jsonl"))).toBe(true);

    const loaded = store.get("test");
    expect(loaded.length).toBe(1);
    expect(loaded[0].content as string).toBe("summary 2");
  });

  test("getPath returns highest-numbered file after rotation", () => {
    const bigMsg = buildUserMessage("x".repeat(10_000));
    const count = Math.ceil(ROTATION_SIZE / 10_000) + 1;
    for (let i = 0; i < count; i++) {
      store.append("test", [bigMsg]);
    }
    store.compact("test", [buildUserMessage("summary")]);

    const path = store.getPath("test");
    expect(path).toContain("test.1.jsonl");
  });
});
