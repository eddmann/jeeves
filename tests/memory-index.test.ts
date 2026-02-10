import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MemoryIndex, chunkText } from "../src/memory/index";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

let tmpDir: string;

beforeEach(() => {
  tmpDir = createTempDir();
});

afterEach(() => {
  cleanupTempDir(tmpDir);
});

// Stub embedder that returns fixed-dimension vectors based on text hash
function stubEmbedder(texts: string[]): Promise<number[][]> {
  return Promise.resolve(
    texts.map((text) => {
      // Simple deterministic embedding: use char codes
      const vec = new Array(8).fill(0);
      for (let i = 0; i < text.length; i++) {
        vec[i % 8] += text.charCodeAt(i) / 1000;
      }
      // Normalize
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      return norm > 0 ? vec.map((v) => v / norm) : vec;
    }),
  );
}

describe("chunkText", () => {
  test("chunks text into segments", () => {
    const text = Array(100).fill("This is a line of text for testing chunking.").join("\n");

    const chunks = chunkText(text, 200, 40);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBeGreaterThan(0);
  });

  test("returns single chunk for short text", () => {
    const chunks = chunkText("Short text", 1600, 320);

    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe("Short text");
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(1);
  });

  test("returns empty array for empty text", () => {
    const chunks = chunkText("", 1600, 320);

    expect(chunks.length).toBe(0);
  });

  test("chunks have overlap", () => {
    const lines = Array(50)
      .fill("A moderately long line of text for testing.")
      .map((l, i) => `Line ${i}: ${l}`);
    const text = lines.join("\n");

    const chunks = chunkText(text, 400, 100);

    if (chunks.length >= 2) {
      // Check that some content from end of chunk 0 appears in chunk 1
      const chunk0Lines = chunks[0].text.split("\n");
      const chunk1Lines = chunks[1].text.split("\n");
      const lastLineOfChunk0 = chunk0Lines[chunk0Lines.length - 1];
      const hasOverlap = chunk1Lines.some((l) => l === lastLineOfChunk0);
      expect(hasOverlap).toBe(true);
    }
  });
});

describe("MemoryIndex", () => {
  test("creates database and schema", () => {
    const dbPath = join(tmpDir, "memory", "index.sqlite");
    const index = new MemoryIndex(dbPath, stubEmbedder, tmpDir);

    // Should not throw
    index.close();
  });

  test("syncs and indexes memory files", async () => {
    // Create workspace structure
    const memoryDir = join(tmpDir, "memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(tmpDir, "MEMORY.md"), "# Important Facts\n\nThe sky is blue.\n");
    writeFileSync(join(memoryDir, "notes.md"), "# Notes\n\nRemember to buy milk.\n");

    const dbPath = join(memoryDir, "index.sqlite");
    const index = new MemoryIndex(dbPath, stubEmbedder, tmpDir);

    await index.sync();

    // Search should find something
    const results = await index.search("sky color");

    expect(results.length).toBeGreaterThan(0);
    index.close();
  });

  test("re-syncs when file content changes", async () => {
    const memoryDir = join(tmpDir, "memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(tmpDir, "MEMORY.md"), "Original content");

    const dbPath = join(memoryDir, "index.sqlite");
    const index = new MemoryIndex(dbPath, stubEmbedder, tmpDir);

    await index.sync();

    // Change the file
    writeFileSync(join(tmpDir, "MEMORY.md"), "Updated content with new information");

    await index.sync();

    const results = await index.search("updated information");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain("Updated");

    index.close();
  });

  test("removes stale file entries on sync", async () => {
    const memoryDir = join(tmpDir, "memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, "temp.md"), "Temporary note");

    const dbPath = join(memoryDir, "index.sqlite");
    const index = new MemoryIndex(dbPath, stubEmbedder, tmpDir);

    await index.sync();
    let results = await index.search("temporary");
    expect(results.length).toBeGreaterThan(0);

    // Delete the file and re-sync
    const { unlinkSync } = require("fs");
    unlinkSync(join(memoryDir, "temp.md"));

    await index.sync();
    results = await index.search("temporary");
    expect(results.length).toBe(0);

    index.close();
  });

  test("indexes session files", async () => {
    const sessionsDir = join(tmpDir, "sessions");
    mkdirSync(sessionsDir, { recursive: true });

    const sessionData = [
      JSON.stringify({ role: "user", content: "What is the capital of France?" }),
      JSON.stringify({ role: "assistant", content: "The capital of France is Paris." }),
    ].join("\n");

    writeFileSync(join(sessionsDir, "test.jsonl"), sessionData);

    const dbPath = join(tmpDir, "memory", "index.sqlite");
    const index = new MemoryIndex(dbPath, stubEmbedder, tmpDir);

    await index.indexSessionFiles(sessionsDir);

    const results = await index.search("capital France");
    expect(results.length).toBeGreaterThan(0);

    index.close();
  });

  test("handles empty workspace gracefully", async () => {
    const dbPath = join(tmpDir, "memory", "index.sqlite");
    const index = new MemoryIndex(dbPath, stubEmbedder, tmpDir);

    await index.sync();

    const results = await index.search("anything");
    expect(results.length).toBe(0);

    index.close();
  });

  test("keyword search works without embeddings", async () => {
    const memoryDir = join(tmpDir, "memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(tmpDir, "MEMORY.md"), "The quick brown fox jumps over the lazy dog");

    // Use an embedder that always fails
    const failEmbedder = async () => {
      throw new Error("No embeddings available");
    };

    const dbPath = join(memoryDir, "index.sqlite");
    const index = new MemoryIndex(dbPath, failEmbedder, tmpDir);

    await index.sync();

    // Keyword search should still work
    const results = await index.search("brown fox");
    expect(results.length).toBeGreaterThan(0);

    index.close();
  });
});
