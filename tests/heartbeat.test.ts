import { describe, test, expect, beforeEach, afterEach, setSystemTime } from "bun:test";
import { HeartbeatRunner } from "../src/heartbeat";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import { writeFileSync } from "fs";
import { join } from "path";

let tmpDir: string;

beforeEach(() => {
  tmpDir = createTempDir();
});

afterEach(() => {
  setSystemTime();
  cleanupTempDir(tmpDir);
});

function makeRunner(opts: {
  runAgentResult?: string;
  runAgentError?: Error;
  activeHours?: { start: string; end: string };
}) {
  const sendCalls: string[] = [];
  const runAgentCalls: string[] = [];

  const runner = new HeartbeatRunner({
    intervalMs: 60000,
    workspaceDir: tmpDir,
    runAgent: async (msg: string) => {
      runAgentCalls.push(msg);
      if (opts.runAgentError) throw opts.runAgentError;
      return opts.runAgentResult ?? "HEARTBEAT_OK";
    },
    sendToChannel: async (text: string) => {
      sendCalls.push(text);
    },
    activeHours: opts.activeHours,
  });

  return { runner, sendCalls, runAgentCalls };
}

describe("periodic heartbeat", () => {
  test("skips when outside active hours", async () => {
    setSystemTime(new Date("2025-01-15T03:00:00"));
    writeFileSync(join(tmpDir, "HEARTBEAT.md"), "Check stuff\nDo things");
    const { runner, runAgentCalls } = makeRunner({
      activeHours: { start: "08:00", end: "23:00" },
    });

    await runner.runOnce();

    expect(runAgentCalls.length).toBe(0);
  });

  test("skips when HEARTBEAT.md does not exist", async () => {
    setSystemTime(new Date("2025-01-15T12:00:00"));
    const { runner, runAgentCalls } = makeRunner({
      activeHours: { start: "08:00", end: "23:00" },
    });

    await runner.runOnce();

    expect(runAgentCalls.length).toBe(0);
  });

  test("skips when HEARTBEAT.md contains only headings", async () => {
    setSystemTime(new Date("2025-01-15T12:00:00"));
    writeFileSync(join(tmpDir, "HEARTBEAT.md"), "# Heartbeat\n## Section\n");
    const { runner, runAgentCalls } = makeRunner({
      activeHours: { start: "08:00", end: "23:00" },
    });

    await runner.runOnce();

    expect(runAgentCalls.length).toBe(0);
  });

  test("runs agent when content exists and within active hours", async () => {
    setSystemTime(new Date("2025-01-15T12:00:00"));
    writeFileSync(join(tmpDir, "HEARTBEAT.md"), "# Checks\nCheck the weather");
    const { runner, runAgentCalls } = makeRunner({
      activeHours: { start: "08:00", end: "23:00" },
    });

    await runner.runOnce();

    expect(runAgentCalls.length).toBe(1);
  });

  test("suppresses HEARTBEAT_OK response from channel", async () => {
    setSystemTime(new Date("2025-01-15T12:00:00"));
    writeFileSync(join(tmpDir, "HEARTBEAT.md"), "Check things\nDo stuff");
    const { runner, sendCalls } = makeRunner({
      runAgentResult: "HEARTBEAT_OK",
      activeHours: { start: "08:00", end: "23:00" },
    });

    await runner.runOnce();

    expect(sendCalls.length).toBe(0);
  });

  test("sends non-OK response to channel", async () => {
    setSystemTime(new Date("2025-01-15T12:00:00"));
    writeFileSync(join(tmpDir, "HEARTBEAT.md"), "Check things\nDo stuff");
    const { runner, sendCalls } = makeRunner({
      runAgentResult: "Something needs attention!",
      activeHours: { start: "08:00", end: "23:00" },
    });

    await runner.runOnce();

    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0]).toBe("Something needs attention!");
  });

  test("deduplicates identical messages within 24 hours", async () => {
    setSystemTime(new Date("2025-01-15T12:00:00"));
    writeFileSync(join(tmpDir, "HEARTBEAT.md"), "Check things\nDo stuff");
    const { runner, sendCalls } = makeRunner({
      runAgentResult: "Alert: disk full",
      activeHours: { start: "08:00", end: "23:00" },
    });
    await runner.runOnce();
    expect(sendCalls.length).toBe(1);

    setSystemTime(new Date("2025-01-15T13:00:00"));
    await runner.runOnce();

    expect(sendCalls.length).toBe(1);
  });

  test("re-sends duplicate message after 24 hours", async () => {
    setSystemTime(new Date("2025-01-15T12:00:00"));
    writeFileSync(join(tmpDir, "HEARTBEAT.md"), "Check things\nDo stuff");
    const { runner, sendCalls } = makeRunner({
      runAgentResult: "Alert: disk full",
      activeHours: { start: "08:00", end: "23:00" },
    });
    await runner.runOnce();
    expect(sendCalls.length).toBe(1);

    setSystemTime(new Date("2025-01-16T13:00:00"));
    await runner.runOnce();

    expect(sendCalls.length).toBe(2);
  });

  test("handles agent errors without crashing", async () => {
    setSystemTime(new Date("2025-01-15T12:00:00"));
    writeFileSync(join(tmpDir, "HEARTBEAT.md"), "Check things\nDo stuff");
    const { runner, sendCalls } = makeRunner({
      runAgentError: new Error("LLM is down"),
      activeHours: { start: "08:00", end: "23:00" },
    });

    await runner.runOnce();

    expect(sendCalls.length).toBe(0);
  });

  test("runs during late night when active hours wrap midnight", async () => {
    setSystemTime(new Date("2025-01-15T23:30:00"));
    writeFileSync(join(tmpDir, "HEARTBEAT.md"), "Check things\nDo stuff");
    const { runner, runAgentCalls } = makeRunner({
      activeHours: { start: "22:00", end: "06:00" },
    });

    await runner.runOnce();

    expect(runAgentCalls.length).toBe(1);
  });

  test("skips during daytime when active hours wrap midnight", async () => {
    setSystemTime(new Date("2025-01-15T12:00:00"));
    writeFileSync(join(tmpDir, "HEARTBEAT.md"), "Check things\nDo stuff");
    const { runner, runAgentCalls } = makeRunner({
      activeHours: { start: "22:00", end: "06:00" },
    });

    await runner.runOnce();

    expect(runAgentCalls.length).toBe(0);
  });

  test("runs at any hour when no active hours are configured", async () => {
    setSystemTime(new Date("2025-01-15T03:00:00"));
    writeFileSync(join(tmpDir, "HEARTBEAT.md"), "Check things\nDo stuff");
    const { runner, runAgentCalls } = makeRunner({});

    await runner.runOnce();

    expect(runAgentCalls.length).toBe(1);
  });
});
