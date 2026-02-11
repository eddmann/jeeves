import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createEditFileTool } from "../src/tools/edit-file";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import { join } from "path";
import { readFileSync } from "fs";

let tmpDir: string;
let tool: ReturnType<typeof createEditFileTool>;

beforeEach(() => {
  tmpDir = createTempDir();
  tool = createEditFileTool(tmpDir);
});

afterEach(() => {
  cleanupTempDir(tmpDir);
});

describe("edit file tool", () => {
  test("replaces a unique string", async () => {
    await Bun.write(join(tmpDir, "file.txt"), "hello world");
    const result = await tool.execute({
      path: "file.txt",
      old_string: "hello",
      new_string: "goodbye",
    });
    expect(result).toContain("Replaced 1 occurrence");
    expect(readFileSync(join(tmpDir, "file.txt"), "utf-8")).toBe("goodbye world");
  });

  test("returns error when old_string not found", async () => {
    await Bun.write(join(tmpDir, "file.txt"), "line 1\nline 2\n");
    const result = await tool.execute({
      path: "file.txt",
      old_string: "missing",
      new_string: "replacement",
    });
    expect(result).toContain("old_string not found");
    expect(result).toContain("line 1");
  });

  test("returns error for multiple occurrences without replace_all", async () => {
    await Bun.write(join(tmpDir, "file.txt"), "foo bar foo baz foo");
    const result = await tool.execute({
      path: "file.txt",
      old_string: "foo",
      new_string: "qux",
    });
    expect(result).toContain("found 3 occurrences");
    // File should be unchanged
    expect(readFileSync(join(tmpDir, "file.txt"), "utf-8")).toBe("foo bar foo baz foo");
  });

  test("replaces all occurrences when replace_all is true", async () => {
    await Bun.write(join(tmpDir, "file.txt"), "foo bar foo baz foo");
    const result = await tool.execute({
      path: "file.txt",
      old_string: "foo",
      new_string: "qux",
      replace_all: true,
    });
    expect(result).toContain("Replaced 3 occurrences");
    expect(readFileSync(join(tmpDir, "file.txt"), "utf-8")).toBe("qux bar qux baz qux");
  });

  test("resolves relative paths from workspace", async () => {
    await Bun.write(join(tmpDir, "sub/deep.txt"), "old content");
    const result = await tool.execute({
      path: "sub/deep.txt",
      old_string: "old",
      new_string: "new",
    });
    expect(result).toContain("Replaced 1 occurrence");
    expect(readFileSync(join(tmpDir, "sub/deep.txt"), "utf-8")).toBe("new content");
  });

  test("handles absolute paths", async () => {
    const absPath = join(tmpDir, "abs.txt");
    await Bun.write(absPath, "absolute test");
    const result = await tool.execute({
      path: absPath,
      old_string: "absolute",
      new_string: "relative",
    });
    expect(result).toContain("Replaced 1 occurrence");
    expect(readFileSync(absPath, "utf-8")).toBe("relative test");
  });

  test("returns error for non-existent file", async () => {
    const result = await tool.execute({
      path: "nope.txt",
      old_string: "x",
      new_string: "y",
    });
    expect(result).toContain("file not found");
  });
});
