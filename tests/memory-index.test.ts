import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MemoryIndex, chunkText } from "../src/memory/index";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";

let tmpDir: string;
let memoryDir: string;
let sessionsDir: string;

beforeEach(() => {
  tmpDir = createTempDir();
  memoryDir = join(tmpDir, "memory");
  sessionsDir = join(tmpDir, "sessions");
  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
});

afterEach(() => {
  cleanupTempDir(tmpDir);
});

// Stub embedder that returns fixed-dimension vectors based on text hash
function stubEmbedder(texts: string[]): Promise<number[][]> {
  return Promise.resolve(
    texts.map((text) => {
      const vec = new Array(8).fill(0);
      for (let i = 0; i < text.length; i++) {
        vec[i % 8] += text.charCodeAt(i) / 1000;
      }
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      return norm > 0 ? vec.map((v) => v / norm) : vec;
    }),
  );
}

// No-op embedder for tests that need precise keyword-only assertions
const noopEmbedder = async () => [] as number[][];

function msg(role: string, content: string): string {
  return JSON.stringify({ role, content });
}

const COMPACTION_MARKER = '{"@@compaction":true}';

function createIndex(embedder = stubEmbedder): MemoryIndex {
  return new MemoryIndex(join(memoryDir, "index.sqlite"), embedder, tmpDir);
}

describe("chunkText", () => {
  test("splits long text into overlapping segments", () => {
    const lines = Array(50)
      .fill("A moderately long line of text for testing.")
      .map((l, i) => `Line ${i}: ${l}`);
    const text = lines.join("\n");

    const chunks = chunkText(text, 400, 100);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startLine).toBe(1);

    // Verify overlap: last line of chunk 0 appears in chunk 1
    const chunk0Lines = chunks[0].text.split("\n");
    const chunk1Lines = chunks[1].text.split("\n");
    const lastLineOfChunk0 = chunk0Lines[chunk0Lines.length - 1];
    expect(chunk1Lines).toContain(lastLineOfChunk0);
  });

  test("returns single chunk for short text", () => {
    const chunks = chunkText("Short text");
    expect(chunks).toEqual([{ text: "Short text", startLine: 1, endLine: 1 }]);
  });

  test("returns empty array for empty text", () => {
    expect(chunkText("")).toEqual([]);
  });
});

describe("memory file syncing", () => {
  test("indexes MEMORY.md and memory/*.md files, making them searchable", async () => {
    writeFileSync(join(tmpDir, "MEMORY.md"), "# Facts\n\nThe sky is blue.\n");
    writeFileSync(join(memoryDir, "notes.md"), "# Notes\n\nRemember to buy milk.\n");

    const index = createIndex();
    await index.sync();

    expect((await index.search("sky color")).length).toBeGreaterThan(0);
    expect((await index.search("buy milk")).length).toBeGreaterThan(0);

    index.close();
  });

  test("picks up changes when a memory file is modified", async () => {
    writeFileSync(join(tmpDir, "MEMORY.md"), "Original content about elephants");

    const index = createIndex(noopEmbedder);
    await index.sync();

    writeFileSync(join(tmpDir, "MEMORY.md"), "Updated content about kangaroos");
    await index.sync();

    const results = await index.search("kangaroos");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain("kangaroos");
    expect((await index.search("elephants")).length).toBe(0);

    index.close();
  });

  test("removes entries when a memory file is deleted", async () => {
    writeFileSync(join(memoryDir, "temp.md"), "Temporary note about penguins");

    const index = createIndex();
    await index.sync();
    expect((await index.search("penguins")).length).toBeGreaterThan(0);

    unlinkSync(join(memoryDir, "temp.md"));
    await index.sync();
    expect((await index.search("penguins")).length).toBe(0);

    index.close();
  });

  test("sync does not index session files", async () => {
    writeFileSync(
      join(sessionsDir, "test.jsonl"),
      [msg("user", "What about platypuses?"), msg("assistant", "Platypuses lay eggs.")].join("\n"),
    );

    const index = createIndex();
    await index.sync();

    expect((await index.search("platypuses")).length).toBe(0);

    index.close();
  });

  test("re-indexes files that had missing embeddings", async () => {
    writeFileSync(join(tmpDir, "MEMORY.md"), "Important fact about quokkas");

    // First sync with failing embedder — chunks stored without vectors
    let shouldFail = true;
    const failOnceEmbedder = async (texts: string[]) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("network timeout");
      }
      return stubEmbedder(texts);
    };

    const index = new MemoryIndex(join(memoryDir, "index.sqlite"), failOnceEmbedder, tmpDir);

    await index.sync(); // First sync: embeddings fail
    // Keyword search works even without embeddings
    expect((await index.search("quokkas")).length).toBeGreaterThan(0);

    await index.sync(); // Second sync: should retry and succeed
    // Still searchable after re-indexing with embeddings
    expect((await index.search("quokkas")).length).toBeGreaterThan(0);

    index.close();
  });
});

describe("session file indexing", () => {
  test("does not index the active session when it has no compaction marker", async () => {
    const data = [
      msg("user", "Tell me about quasars"),
      msg("assistant", "Quasars are luminous objects."),
    ].join("\n");
    writeFileSync(join(sessionsDir, "chat.jsonl"), data);

    const index = createIndex();
    await index.sync();

    // Everything is in the LLM's context — nothing to index
    expect((await index.search("quasars")).length).toBe(0);

    index.close();
  });

  test("indexes only pre-compaction content from the active session", async () => {
    writeFileSync(
      join(sessionsDir, "chat.jsonl"),
      [
        msg("user", "What is the capital of France?"),
        msg("assistant", "The capital of France is Paris."),
        COMPACTION_MARKER,
        msg("user", "[Previous summary] Discussed capitals."),
        msg("user", "Tell me about xylophone manufacturing."),
        msg("assistant", "Xylophones are crafted from rosewood."),
      ].join("\n"),
    );

    const index = createIndex(noopEmbedder);
    await index.sync();

    // Pre-compaction content is searchable
    expect((await index.search("capital France")).length).toBeGreaterThan(0);
    // Post-compaction content is NOT indexed (it's in context)
    expect((await index.search("xylophone rosewood")).length).toBe(0);

    index.close();
  });

  test("indexes archived session files fully", async () => {
    // Archived file (seq 0) — fully historical
    writeFileSync(
      join(sessionsDir, "chat.jsonl"),
      [msg("user", "What is the capital of France?"), msg("assistant", "Paris.")].join("\n"),
    );
    // Active file (seq 1) — makes chat.jsonl archived
    writeFileSync(join(sessionsDir, "chat.1.jsonl"), msg("user", "hi"));

    const index = createIndex();
    await index.sync();

    expect((await index.search("capital France")).length).toBeGreaterThan(0);

    index.close();
  });

  test("after rotation, old file becomes fully searchable and new file is skipped", async () => {
    // Simulate post-rotation state:
    // Old file has compaction markers + all historical content
    writeFileSync(
      join(sessionsDir, "chat.jsonl"),
      [
        msg("user", "Tell me about flamingos."),
        msg("assistant", "Flamingos are pink wading birds."),
        COMPACTION_MARKER,
        msg("user", "[Summary] Discussed birds."),
        msg("user", "What about pelicans?"),
        msg("assistant", "Pelicans have large throat pouches."),
      ].join("\n"),
    );

    // New file (active) has just the compacted messages, no marker yet
    writeFileSync(
      join(sessionsDir, "chat.1.jsonl"),
      [msg("user", "[Summary] Discussed birds and pelicans."), msg("user", "And toucans?")].join(
        "\n",
      ),
    );

    const index = createIndex(noopEmbedder);
    await index.sync();

    // Old file indexed fully — both pre- and post-compaction content
    expect((await index.search("flamingos")).length).toBeGreaterThan(0);
    expect((await index.search("pelicans")).length).toBeGreaterThan(0);
    // New active file with no marker — not indexed
    expect((await index.search("toucans")).length).toBe(0);

    index.close();
  });

  test("re-indexes active session when new compaction marker appears", async () => {
    const index = createIndex(noopEmbedder);

    // First compaction: France is before the marker
    writeFileSync(
      join(sessionsDir, "chat.jsonl"),
      [
        msg("user", "What is the capital of France?"),
        msg("assistant", "Paris."),
        COMPACTION_MARKER,
        msg("user", "[Summary] Discussed France."),
      ].join("\n"),
    );

    await index.sync();
    expect((await index.search("capital France")).length).toBeGreaterThan(0);

    // Second compaction: Germany conversation added, new marker
    writeFileSync(
      join(sessionsDir, "chat.jsonl"),
      [
        msg("user", "What is the capital of France?"),
        msg("assistant", "Paris."),
        COMPACTION_MARKER,
        msg("user", "[Summary] Discussed France."),
        msg("user", "What about Germany?"),
        msg("assistant", "Berlin."),
        COMPACTION_MARKER,
        msg("user", "[Summary] Discussed France and Germany."),
      ].join("\n"),
    );

    await index.sync();

    // Both France AND Germany now in pre-marker content
    expect((await index.search("capital France")).length).toBeGreaterThan(0);
    expect((await index.search("Germany Berlin")).length).toBeGreaterThan(0);

    index.close();
  });

  test("handles multiple independent session groups", async () => {
    // Telegram session — archived + active
    writeFileSync(
      join(sessionsDir, "telegram_123.jsonl"),
      msg("user", "Discuss narwhals with me."),
    );
    writeFileSync(join(sessionsDir, "telegram_123.1.jsonl"), msg("user", "hi"));

    // Cron session — single file, active, no marker
    writeFileSync(
      join(sessionsDir, "cron_abc.jsonl"),
      msg("assistant", "HN briefing about algorithms."),
    );

    const index = createIndex(noopEmbedder);
    await index.sync();

    // Archived telegram file is searchable
    expect((await index.search("narwhals")).length).toBeGreaterThan(0);
    // Active cron file with no marker is not indexed
    expect((await index.search("algorithms")).length).toBe(0);

    index.close();
  });
});

describe("keyword-only fallback", () => {
  test("search still works when embeddings fail", async () => {
    writeFileSync(join(tmpDir, "MEMORY.md"), "The quick brown fox jumps over the lazy dog");

    const failEmbedder = async () => {
      throw new Error("No embeddings available");
    };

    const index = new MemoryIndex(join(memoryDir, "index.sqlite"), failEmbedder, tmpDir);
    await index.sync();

    const results = await index.search("brown fox");
    expect(results.length).toBeGreaterThan(0);

    index.close();
  });
});

describe("empty workspace", () => {
  test("search returns no results gracefully", async () => {
    const index = createIndex();
    await index.sync();

    expect(await index.search("anything")).toEqual([]);

    index.close();
  });
});
