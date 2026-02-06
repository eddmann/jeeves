import { describe, test, expect, beforeEach, afterEach, setSystemTime } from "bun:test";
import { CronScheduler } from "../src/cron/scheduler";
import { createCronTool } from "../src/tools/cron";
import { saveJobs } from "../src/cron/store";
import { buildCronJob } from "./helpers/factories";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

let tmpDir: string;
let storePath: string;

beforeEach(() => {
  tmpDir = createTempDir();
  storePath = join(tmpDir, "jobs.json");
});

afterEach(() => {
  setSystemTime();
  cleanupTempDir(tmpDir);
});

function makeScheduler() {
  const firedJobs: Array<{ id: string; name: string; message: string }> = [];
  const scheduler = new CronScheduler({
    storePath,
    onJobDue: async (job) => {
      firedJobs.push({ id: job.id, name: job.name, message: job.message });
    },
  });
  return { scheduler, firedJobs };
}

function makeTool() {
  const firedJobs: Array<{ id: string; message: string }> = [];
  const scheduler = new CronScheduler({
    storePath,
    onJobDue: async (job) => {
      firedJobs.push({ id: job.id, message: job.message });
    },
  });
  const tool = createCronTool(scheduler);
  return { tool, scheduler, firedJobs };
}

describe("scheduling", () => {
  describe("job management", () => {
    test("creates a new job with a generated ID", () => {
      const { scheduler } = makeScheduler();

      const job = scheduler.addJob({
        name: "test",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "every", everyMs: 60000 },
        message: "do it",
      });

      expect(job.id).toBeTruthy();
      expect(job.name).toBe("test");
    });

    test("lists all registered jobs", () => {
      const { scheduler } = makeScheduler();
      scheduler.addJob({
        name: "a",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "every", everyMs: 1000 },
        message: "a",
      });
      scheduler.addJob({
        name: "b",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "every", everyMs: 2000 },
        message: "b",
      });

      const jobs = scheduler.listJobs();

      expect(jobs.length).toBe(2);
    });

    test("removes a job by ID", () => {
      const { scheduler } = makeScheduler();
      const job = scheduler.addJob({
        name: "rm",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "every", everyMs: 1000 },
        message: "x",
      });

      const removed = scheduler.removeJob(job.id);

      expect(removed).toBe(true);
      expect(scheduler.listJobs().length).toBe(0);
    });

    test("returns false when removing a nonexistent job", () => {
      const { scheduler } = makeScheduler();

      const removed = scheduler.removeJob("nonexistent");

      expect(removed).toBe(false);
    });
  });

  describe("schedule types", () => {
    test("'at' schedule with future date sets correct next run time", () => {
      setSystemTime(new Date("2025-06-01T12:00:00Z"));
      const { scheduler } = makeScheduler();

      const job = scheduler.addJob({
        name: "future",
        enabled: true,
        deleteAfterRun: true,
        schedule: { kind: "at", at: "2025-12-25T00:00:00Z" },
        message: "merry christmas",
      });

      expect(job.nextRunAtMs).toBe(new Date("2025-12-25T00:00:00Z").getTime());
    });

    test("'at' schedule with past date schedules immediately", () => {
      setSystemTime(new Date("2025-06-01T12:00:00Z"));
      const { scheduler } = makeScheduler();

      const job = scheduler.addJob({
        name: "past",
        enabled: true,
        deleteAfterRun: true,
        schedule: { kind: "at", at: "2020-01-01T00:00:00Z" },
        message: "overdue",
      });

      expect(job.nextRunAtMs).toBe(Date.now());
    });

    test("'every' schedule sets next run to now plus interval", () => {
      setSystemTime(new Date("2025-06-01T12:00:00Z"));
      const { scheduler } = makeScheduler();

      const job = scheduler.addJob({
        name: "recurring",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "every", everyMs: 60000 },
        message: "tick",
      });

      expect(job.nextRunAtMs).toBe(Date.now() + 60000);
    });

    test("'cron' schedule computes next run within expected window", () => {
      setSystemTime(new Date("2025-06-01T12:00:00Z"));
      const { scheduler } = makeScheduler();
      const oneHourMs = 3600 * 1000;

      const job = scheduler.addJob({
        name: "cron-job",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "cron", expr: "0 * * * *" }, // every hour
        message: "hourly",
      });

      expect(job.nextRunAtMs).toBeDefined();
      expect(job.nextRunAtMs!).toBeGreaterThan(Date.now());
      expect(job.nextRunAtMs!).toBeLessThanOrEqual(Date.now() + oneHourMs);
    });
  });

  describe("job execution", () => {
    test("fires the specified job's callback", async () => {
      const { scheduler, firedJobs } = makeScheduler();
      const job = scheduler.addJob({
        name: "fire-me",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "every", everyMs: 60000 },
        message: "fired",
      });

      await scheduler.runJob(job.id);

      expect(firedJobs.length).toBe(1);
      expect(firedJobs[0].name).toBe("fire-me");
    });

    test("throws when running a nonexistent job", async () => {
      const { scheduler } = makeScheduler();

      expect(scheduler.runJob("nope")).rejects.toThrow("not found");
    });

    test("removes one-shot jobs after execution", async () => {
      const { scheduler } = makeScheduler();
      const job = scheduler.addJob({
        name: "once",
        enabled: true,
        deleteAfterRun: true,
        schedule: { kind: "at", at: "2025-01-01T00:00:00Z" },
        message: "once",
      });

      await scheduler.runJob(job.id);

      expect(scheduler.listJobs().length).toBe(0);
    });

    test("reschedules recurring jobs after execution", async () => {
      setSystemTime(new Date("2025-06-01T12:00:00Z"));
      const { scheduler } = makeScheduler();
      scheduler.addJob({
        name: "recur",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "every", everyMs: 60000 },
        message: "tick",
      });

      setSystemTime(new Date("2025-06-01T12:05:00Z"));
      await scheduler.runJob(scheduler.listJobs()[0].id);
      const jobs = scheduler.listJobs();

      expect(jobs[0].lastRunAtMs).toBeDefined();
      expect(jobs[0].nextRunAtMs).toBe(jobs[0].lastRunAtMs! + 60000);
    });

    test("records success status after successful execution", async () => {
      const { scheduler } = makeScheduler();
      const job = scheduler.addJob({
        name: "ok-job",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "every", everyMs: 60000 },
        message: "ok",
      });

      await scheduler.runJob(job.id);

      expect(scheduler.listJobs()[0].lastStatus).toBe("ok");
    });

    test("records error status after failed execution", async () => {
      const scheduler = new CronScheduler({
        storePath,
        onJobDue: async () => {
          throw new Error("boom");
        },
      });
      const job = scheduler.addJob({
        name: "err-job",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "every", everyMs: 60000 },
        message: "fail",
      });

      await scheduler.runJob(job.id);

      expect(scheduler.listJobs()[0].lastStatus).toBe("error");
    });

    test("does not fire jobs after scheduler is stopped", async () => {
      const { scheduler, firedJobs } = makeScheduler();
      const job = scheduler.addJob({
        name: "after-stop",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "every", everyMs: 100 },
        message: "x",
      });
      scheduler.start();

      scheduler.stop();
      await scheduler.runJob(job.id);

      expect(firedJobs.length).toBe(1);
      expect(scheduler.listJobs().length).toBe(1);
    });
  });

  describe("persistence", () => {
    test("jobs survive scheduler restart", () => {
      const { scheduler } = makeScheduler();
      scheduler.addJob({
        name: "persisted",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "every", everyMs: 60000 },
        message: "persist me",
      });

      const { scheduler: freshScheduler } = makeScheduler();
      freshScheduler.start();
      const jobs = freshScheduler.listJobs();

      expect(jobs.length).toBe(1);
      expect(jobs[0].name).toBe("persisted");
      freshScheduler.stop();
    });

    test("loads pre-existing jobs from store on start", () => {
      saveJobs(storePath, [buildCronJob({ id: "pre", name: "preloaded", enabled: true })]);
      const { scheduler } = makeScheduler();

      scheduler.start();

      expect(scheduler.listJobs().length).toBe(1);
      expect(scheduler.listJobs()[0].name).toBe("preloaded");
      scheduler.stop();
    });

    test("handles corrupt store file gracefully", () => {
      mkdirSync(join(tmpDir, "cron"), { recursive: true });
      writeFileSync(storePath, "not json!", "utf-8");
      const { scheduler } = makeScheduler();

      scheduler.start();

      expect(scheduler.listJobs()).toEqual([]);
      scheduler.stop();
    });
  });

  describe("agent tool interface", () => {
    test("'add' action creates job and returns confirmation", async () => {
      const { tool } = makeTool();

      const result = await tool.execute({
        action: "add",
        name: "test-job",
        message: "do something",
        schedule_type: "every",
        schedule_value: "60000",
      });

      expect(result).toContain("Created job");
      expect(result).toContain("test-job");
      expect(result).toContain("id:");
    });

    test("'add' action validates required fields", async () => {
      const { tool } = makeTool();

      const result = await tool.execute({ action: "add", name: "incomplete" });

      expect(result).toContain("Error");
      expect(result).toContain("required");
    });

    test("'add' action supports at, every, and cron schedule types", async () => {
      const { tool } = makeTool();

      const atResult = await tool.execute({
        action: "add",
        name: "at-job",
        message: "once",
        schedule_type: "at",
        schedule_value: "2026-01-01T00:00:00Z",
      });
      const everyResult = await tool.execute({
        action: "add",
        name: "every-job",
        message: "recurring",
        schedule_type: "every",
        schedule_value: "30000",
      });
      const cronResult = await tool.execute({
        action: "add",
        name: "cron-job",
        message: "scheduled",
        schedule_type: "cron",
        schedule_value: "0 * * * *",
      });

      expect(atResult).toContain("Created job");
      expect(everyResult).toContain("Created job");
      expect(cronResult).toContain("Created job");
    });

    test("'list' action shows all registered jobs", async () => {
      const { tool } = makeTool();
      await tool.execute({
        action: "add",
        name: "job-a",
        message: "a",
        schedule_type: "every",
        schedule_value: "1000",
      });
      await tool.execute({
        action: "add",
        name: "job-b",
        message: "b",
        schedule_type: "every",
        schedule_value: "2000",
      });

      const result = await tool.execute({ action: "list" });

      expect(result).toContain("job-a");
      expect(result).toContain("job-b");
    });

    test("'list' action shows empty message when no jobs exist", async () => {
      const { tool } = makeTool();

      const result = await tool.execute({ action: "list" });

      expect(result).toBe("No scheduled jobs.");
    });

    test("'remove' action deletes a job by ID", async () => {
      const { tool } = makeTool();
      const addResult = await tool.execute({
        action: "add",
        name: "remove-me",
        message: "x",
        schedule_type: "every",
        schedule_value: "1000",
      });
      const id = addResult.match(/id: ([^)]+)/)![1];

      const result = await tool.execute({ action: "remove", id });

      expect(result).toContain("Removed");
    });

    test("'remove' action reports not found for invalid ID", async () => {
      const { tool } = makeTool();

      const result = await tool.execute({ action: "remove", id: "nope" });

      expect(result).toContain("not found");
    });

    test("'run' action triggers the job callback", async () => {
      const { tool, firedJobs } = makeTool();
      const addResult = await tool.execute({
        action: "add",
        name: "run-me",
        message: "fire!",
        schedule_type: "every",
        schedule_value: "60000",
      });
      const id = addResult.match(/id: ([^)]+)/)![1];

      const result = await tool.execute({ action: "run", id });

      expect(result).toContain("Triggered");
      expect(firedJobs.length).toBe(1);
      expect(firedJobs[0].message).toBe("fire!");
    });

    test("'status' action shows job count summary", async () => {
      const { tool } = makeTool();
      await tool.execute({
        action: "add",
        name: "job",
        message: "x",
        schedule_type: "every",
        schedule_value: "1000",
      });

      const result = await tool.execute({ action: "status" });

      expect(result).toContain("1 jobs");
      expect(result).toContain("1 enabled");
    });

    test("unknown action returns error", async () => {
      const { tool } = makeTool();

      const result = await tool.execute({ action: "explode" });

      expect(result).toContain("Unknown action");
    });
  });
});
