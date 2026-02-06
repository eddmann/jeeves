import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createReadFileTool } from "../src/tools/read-file";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import { join } from "path";

let tmpDir: string;
let tool: ReturnType<typeof createReadFileTool>;

beforeEach(() => {
  tmpDir = createTempDir();
  tool = createReadFileTool(tmpDir);
});

afterEach(() => {
  cleanupTempDir(tmpDir);
});

describe("read file tool", () => {
  test("reads file with line numbers", async () => {
    await Bun.write(join(tmpDir, "hello.txt"), "hello world");
    const result = await tool.execute({ path: "hello.txt" });
    expect(result).toBe("1\thello world");
  });

  test("relative path resolves from workspace", async () => {
    await Bun.write(join(tmpDir, "sub", "file.txt"), "content");
    const result = await tool.execute({ path: "sub/file.txt" });
    expect(result).toBe("1\tcontent");
  });

  test("absolute path used as-is", async () => {
    const absPath = join(tmpDir, "abs.txt");
    await Bun.write(absPath, "absolute");
    const result = await tool.execute({ path: absPath });
    expect(result).toBe("1\tabsolute");
  });

  test("multi-line file has correct numbering", async () => {
    await Bun.write(join(tmpDir, "lines.txt"), "a\nb\nc");
    const result = await tool.execute({ path: "lines.txt" });
    expect(result).toBe("1\ta\n2\tb\n3\tc");
  });

  test("file not found returns error", async () => {
    const result = await tool.execute({ path: "nope.txt" });
    expect(result).toContain("Error reading file:");
  });

  test("empty file returns single numbered empty line", async () => {
    await Bun.write(join(tmpDir, "empty.txt"), "");
    const result = await tool.execute({ path: "empty.txt" });
    expect(result).toBe("1\t");
  });
});
