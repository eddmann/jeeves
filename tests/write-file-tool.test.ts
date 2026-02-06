import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createWriteFileTool } from "../src/tools/write-file";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import { join } from "path";
import { readFileSync } from "fs";

let tmpDir: string;
let tool: ReturnType<typeof createWriteFileTool>;

beforeEach(() => {
  tmpDir = createTempDir();
  tool = createWriteFileTool(tmpDir);
});

afterEach(() => {
  cleanupTempDir(tmpDir);
});

describe("write file tool", () => {
  test("writes content and reports length", async () => {
    const result = await tool.execute({ path: "out.txt", content: "hello" });
    expect(result).toContain("5 bytes");
    expect(readFileSync(join(tmpDir, "out.txt"), "utf-8")).toBe("hello");
  });

  test("creates parent directories recursively", async () => {
    const result = await tool.execute({
      path: "a/b/c/deep.txt",
      content: "deep",
    });
    expect(result).toContain("Wrote");
    expect(readFileSync(join(tmpDir, "a/b/c/deep.txt"), "utf-8")).toBe("deep");
  });

  test("overwrites existing file", async () => {
    await Bun.write(join(tmpDir, "existing.txt"), "old");
    await tool.execute({ path: "existing.txt", content: "new" });
    expect(readFileSync(join(tmpDir, "existing.txt"), "utf-8")).toBe("new");
  });

  test("relative path resolves from workspace", async () => {
    await tool.execute({ path: "rel.txt", content: "data" });
    expect(readFileSync(join(tmpDir, "rel.txt"), "utf-8")).toBe("data");
  });

  test("returns error for unwritable path", async () => {
    // Try to write to a path under a file (not a directory)
    await Bun.write(join(tmpDir, "file"), "x");
    const result = await tool.execute({
      path: "file/sub/bad.txt",
      content: "fail",
    });
    expect(result).toContain("Error writing file:");
  });
});
