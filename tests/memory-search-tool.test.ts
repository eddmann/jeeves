import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMemorySearchTool } from "../src/tools/memory-search";
import { MemoryIndex } from "../src/memory/index";
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

describe("memory_search tool", () => {
  test("has correct name and schema", () => {
    const memoryDir = join(tmpDir, "memory");
    mkdirSync(memoryDir, { recursive: true });
    const index = new MemoryIndex(join(memoryDir, "index.sqlite"), stubEmbedder, tmpDir);
    const tool = createMemorySearchTool(index);

    expect(tool.name).toBe("memory_search");
    expect(tool.inputSchema.required).toContain("query");

    index.close();
  });

  test("returns formatted results for matching query", async () => {
    const memoryDir = join(tmpDir, "memory");
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "MEMORY.md"),
      "# Facts\n\nThe sky is blue and the grass is green.\n",
    );

    const index = new MemoryIndex(join(memoryDir, "index.sqlite"), stubEmbedder, tmpDir);
    await index.sync();
    const tool = createMemorySearchTool(index);

    const result = await tool.execute({ query: "sky color blue" });

    expect(result).toContain("MEMORY.md");
    expect(result).toContain("match");

    index.close();
  });

  test("returns no results message for unmatched query", async () => {
    const memoryDir = join(tmpDir, "memory");
    mkdirSync(memoryDir, { recursive: true });

    const index = new MemoryIndex(join(memoryDir, "index.sqlite"), stubEmbedder, tmpDir);
    const tool = createMemorySearchTool(index);

    const result = await tool.execute({ query: "quantum physics" });

    expect(result).toContain("No matching memories found");

    index.close();
  });

  test("returns error for missing query", async () => {
    const memoryDir = join(tmpDir, "memory");
    mkdirSync(memoryDir, { recursive: true });

    const index = new MemoryIndex(join(memoryDir, "index.sqlite"), stubEmbedder, tmpDir);
    const tool = createMemorySearchTool(index);

    const result = await tool.execute({});

    expect(result).toContain("Error");

    index.close();
  });
});
