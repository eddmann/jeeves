import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { createAttachTool } from "../src/tools/attach";

const tmpWorkspace = join(import.meta.dir, ".tmp-attach-test");

function setup() {
  mkdirSync(join(tmpWorkspace, "outbox"), { recursive: true });
}

function teardown() {
  rmSync(tmpWorkspace, { recursive: true, force: true });
}

describe("attach tool", () => {
  beforeEach(setup);
  afterEach(teardown);

  function makeTool(attachments: string[] = []) {
    return { tool: createAttachTool({ attachments, workspaceDir: tmpWorkspace }), attachments };
  }

  test("attaches a valid outbox file", async () => {
    writeFileSync(join(tmpWorkspace, "outbox", "chart.png"), "fake");
    const { tool, attachments } = makeTool();

    const result = await tool.execute({ path: "outbox/chart.png" });

    expect(result).toBe("Attached chart.png");
    expect(attachments).toEqual(["outbox/chart.png"]);
  });

  test("accumulates multiple attachments", async () => {
    writeFileSync(join(tmpWorkspace, "outbox", "a.png"), "fake");
    writeFileSync(join(tmpWorkspace, "outbox", "b.csv"), "fake");
    const { tool, attachments } = makeTool();

    await tool.execute({ path: "outbox/a.png" });
    await tool.execute({ path: "outbox/b.csv" });

    expect(attachments).toEqual(["outbox/a.png", "outbox/b.csv"]);
  });

  test("rejects path outside outbox", async () => {
    writeFileSync(join(tmpWorkspace, "secrets.txt"), "secret");
    const { tool, attachments } = makeTool();

    const result = await tool.execute({ path: "secrets.txt" });

    expect(result).toContain("Error: path must be inside outbox/");
    expect(attachments).toEqual([]);
  });

  test("rejects path traversal", async () => {
    const { tool, attachments } = makeTool();

    const result = await tool.execute({ path: "outbox/../../etc/passwd" });

    expect(result).toContain("Error: path must be inside outbox/");
    expect(attachments).toEqual([]);
  });

  test("rejects absolute path outside outbox", async () => {
    const { tool, attachments } = makeTool();

    const result = await tool.execute({ path: "/etc/passwd" });

    expect(result).toContain("Error: path must be inside outbox/");
    expect(attachments).toEqual([]);
  });

  test("rejects non-existent file", async () => {
    const { tool, attachments } = makeTool();

    const result = await tool.execute({ path: "outbox/missing.png" });

    expect(result).toContain("Error: file not found");
    expect(attachments).toEqual([]);
  });

  test("allows files in outbox subdirectories", async () => {
    mkdirSync(join(tmpWorkspace, "outbox", "charts"), { recursive: true });
    writeFileSync(join(tmpWorkspace, "outbox", "charts", "weekly.png"), "fake");
    const { tool } = makeTool();

    const result = await tool.execute({ path: "outbox/charts/weekly.png" });

    expect(result).toBe("Attached weekly.png");
  });
});
