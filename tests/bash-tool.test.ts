import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createBashTool } from "../src/tools/bash";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";

let tmpDir: string;
let tool: ReturnType<typeof createBashTool>;

beforeEach(() => {
  tmpDir = createTempDir();
  tool = createBashTool(tmpDir);
});

afterEach(() => {
  cleanupTempDir(tmpDir);
});

describe("bash tool", () => {
  test("successful command returns stdout", async () => {
    const result = await tool.execute({ command: "echo hello" });
    expect(result).toBe("hello");
  });

  test('returns "(no output)" for silent commands', async () => {
    const result = await tool.execute({ command: "true" });
    expect(result).toBe("(no output)");
  });

  test("non-zero exit code prefixed in output", async () => {
    const result = await tool.execute({ command: "echo fail && exit 42" });
    expect(result).toContain("[exit code 42]");
    expect(result).toContain("fail");
  });

  test("stderr included in output", async () => {
    const result = await tool.execute({ command: "echo err >&2" });
    expect(result).toBe("err");
  });

  test("command runs in workspace directory", async () => {
    const result = await tool.execute({ command: "pwd" });
    // Resolve symlinks (macOS /tmp → /private/tmp)
    const { realpathSync } = require("fs");
    expect(result).toBe(realpathSync(tmpDir));
  });

  test("timeout returns error/exit code", async () => {
    const result = await tool.execute({ command: "sleep 10", timeout: 100 });
    // Bun.spawnSync with exceeded timeout returns non-zero exit code
    expect(result).toMatch(/\[exit code|Error/);
  });
});
