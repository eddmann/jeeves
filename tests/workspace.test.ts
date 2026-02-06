import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadWorkspaceFiles, initWorkspace, loadWorkspaceEnv } from "../src/workspace/loader";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import { existsSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

let tmpDir: string;

beforeEach(() => {
  tmpDir = createTempDir();
});

afterEach(() => {
  cleanupTempDir(tmpDir);
});

describe("workspace file loading", () => {
  test("loads convention files that exist", () => {
    writeFileSync(join(tmpDir, "MEMORY.md"), "Remember this");
    writeFileSync(join(tmpDir, "SOUL.md"), "Be helpful");

    const files = loadWorkspaceFiles(tmpDir);

    expect(files.length).toBe(2);
    expect(files.find((f) => f.name === "MEMORY.md")?.content).toBe("Remember this");
    expect(files.find((f) => f.name === "SOUL.md")?.content).toBe("Be helpful");
  });

  test("ignores non-convention files", () => {
    writeFileSync(join(tmpDir, "RANDOM.md"), "ignore me");
    writeFileSync(join(tmpDir, "MEMORY.md"), "keep me");

    const files = loadWorkspaceFiles(tmpDir);

    expect(files.length).toBe(1);
    expect(files[0].name).toBe("MEMORY.md");
  });

  test("returns empty list from empty directory", () => {
    const files = loadWorkspaceFiles(tmpDir);

    expect(files).toEqual([]);
  });

  test("truncates files exceeding the size limit", () => {
    const oversized = "x".repeat(25000);
    writeFileSync(join(tmpDir, "MEMORY.md"), oversized);

    const files = loadWorkspaceFiles(tmpDir);

    expect(files.length).toBe(1);
    expect(files[0].content.length).toBeLessThan(oversized.length);
    expect(files[0].content).toContain("truncated");
  });
});

describe("workspace initialization", () => {
  test("creates required subdirectories", () => {
    const ws = join(tmpDir, "workspace");
    const tmplDir = join(tmpDir, "templates");
    mkdirSync(tmplDir, { recursive: true });

    initWorkspace(ws, tmplDir);

    expect(existsSync(join(ws, "skills"))).toBe(true);
    expect(existsSync(join(ws, "memory"))).toBe(true);
    expect(existsSync(join(ws, "sessions"))).toBe(true);
    expect(existsSync(join(ws, "cron"))).toBe(true);
  });

  test("seeds a default .env file", () => {
    const ws = join(tmpDir, "workspace");
    const tmplDir = join(tmpDir, "templates");
    mkdirSync(tmplDir, { recursive: true });

    initWorkspace(ws, tmplDir);

    expect(existsSync(join(ws, ".env"))).toBe(true);
  });

  test("copies template files into workspace", () => {
    const ws = join(tmpDir, "workspace");
    const tmplDir = join(tmpDir, "templates");
    mkdirSync(tmplDir, { recursive: true });
    writeFileSync(join(tmplDir, "SOUL.md"), "Be kind");

    initWorkspace(ws, tmplDir);

    expect(existsSync(join(ws, "SOUL.md"))).toBe(true);
  });

  test("preserves existing files over templates", () => {
    const ws = join(tmpDir, "workspace");
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "SOUL.md"), "Original");
    const tmplDir = join(tmpDir, "templates");
    mkdirSync(tmplDir, { recursive: true });
    writeFileSync(join(tmplDir, "SOUL.md"), "Template");

    initWorkspace(ws, tmplDir);

    expect(readFileSync(join(ws, "SOUL.md"), "utf-8")).toBe("Original");
  });

  test("handles missing template directory gracefully", () => {
    const ws = join(tmpDir, "workspace");
    const tmplDir = join(tmpDir, "no-such-templates");

    initWorkspace(ws, tmplDir);

    expect(existsSync(ws)).toBe(true);
  });
});

describe("workspace environment loading", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv["TEST_VAR_A"] = process.env["TEST_VAR_A"];
    savedEnv["TEST_VAR_B"] = process.env["TEST_VAR_B"];
    savedEnv["TEST_EXISTING"] = process.env["TEST_EXISTING"];
    delete process.env["TEST_VAR_A"];
    delete process.env["TEST_VAR_B"];
    delete process.env["TEST_EXISTING"];
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  test("loads key=value pairs into process.env", () => {
    writeFileSync(join(tmpDir, ".env"), "TEST_VAR_A=hello\nTEST_VAR_B=world\n");

    loadWorkspaceEnv(tmpDir);

    expect(process.env["TEST_VAR_A"]).toBe("hello");
    expect(process.env["TEST_VAR_B"]).toBe("world");
  });

  test("does not override existing environment variables", () => {
    process.env["TEST_EXISTING"] = "original";
    writeFileSync(join(tmpDir, ".env"), "TEST_EXISTING=override\n");

    loadWorkspaceEnv(tmpDir);

    expect(process.env["TEST_EXISTING"]).toBe("original");
  });

  test("ignores comments and blank lines", () => {
    writeFileSync(join(tmpDir, ".env"), "# comment\n\nTEST_VAR_A=value\n  \n");

    loadWorkspaceEnv(tmpDir);

    expect(process.env["TEST_VAR_A"]).toBe("value");
  });

  test("handles missing .env file gracefully", () => {
    loadWorkspaceEnv(join(tmpDir, "nonexistent"));
  });
});
