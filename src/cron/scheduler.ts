/**
 * Cron scheduler — manages scheduled jobs with a single setTimeout timer.
 */

import { Cron } from "croner";
import { randomUUID } from "crypto";
import { loadJobs, saveJobs, type CronJob } from "./store";
import { log, formatError } from "../logger";

export class CronScheduler {
  private jobs: CronJob[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private opts: {
      storePath: string;
      onJobDue: (job: CronJob) => Promise<void>;
    },
  ) {}

  start(): void {
    this.jobs = loadJobs(this.opts.storePath);
    this.running = true;
    this.computeNextRuns();
    this.armTimer();
    log.info("cron", "Scheduler started", { jobs: this.jobs.length });
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  addJob(partial: Omit<CronJob, "id" | "createdAtMs" | "nextRunAtMs">): CronJob {
    const job: CronJob = {
      ...partial,
      id: randomUUID().slice(0, 8),
      createdAtMs: Date.now(),
    };
    this.computeNextRun(job);
    this.jobs.push(job);
    this.persist();
    this.armTimer();
    return job;
  }

  removeJob(id: string): boolean {
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return false;
    this.jobs.splice(idx, 1);
    this.persist();
    this.armTimer();
    return true;
  }

  listJobs(): CronJob[] {
    return [...this.jobs];
  }

  async runJob(id: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Job ${id} not found`);
    await this.fireJob(job);
  }

  private computeNextRun(job: CronJob): void {
    const now = Date.now();

    switch (job.schedule.kind) {
      case "at": {
        const atMs = new Date(job.schedule.at).getTime();
        job.nextRunAtMs = atMs > now ? atMs : now;
        break;
      }
      case "every": {
        const base = job.lastRunAtMs ?? now;
        job.nextRunAtMs = base + job.schedule.everyMs;
        if (job.nextRunAtMs <= now) {
          job.nextRunAtMs = now + 1000; // Run soon if overdue
        }
        break;
      }
      case "cron": {
        try {
          const cron = new Cron(job.schedule.expr, {
            timezone: job.schedule.tz,
          });
          const next = cron.nextRun();
          job.nextRunAtMs = next ? next.getTime() : undefined;
        } catch (err) {
          log.error("cron", "Invalid cron expression", { jobId: job.id, ...formatError(err) });
          job.nextRunAtMs = undefined;
        }
        break;
      }
    }
  }

  private computeNextRuns(): void {
    for (const job of this.jobs) {
      if (job.enabled) {
        this.computeNextRun(job);
      }
    }
  }

  private armTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.running) return;

    const now = Date.now();
    let soonest = Infinity;

    for (const job of this.jobs) {
      if (job.enabled && job.nextRunAtMs != null && job.nextRunAtMs < soonest) {
        soonest = job.nextRunAtMs;
      }
    }

    if (soonest === Infinity) return;

    const delay = Math.max(soonest - now, 100);
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    const now = Date.now();
    const dueJobs = this.jobs.filter(
      (j) => j.enabled && j.nextRunAtMs != null && j.nextRunAtMs <= now,
    );

    for (const job of dueJobs) {
      await this.fireJob(job);
    }

    this.armTimer();
  }

  private async fireJob(job: CronJob): Promise<void> {
    log.info("cron", "Firing job", { name: job.name, id: job.id });
    try {
      await this.opts.onJobDue(job);
      job.lastRunAtMs = Date.now();
      job.lastStatus = "ok";
    } catch (err) {
      log.error("cron", "Job failed", { id: job.id, ...formatError(err) });
      job.lastRunAtMs = Date.now();
      job.lastStatus = "error";
    }

    if (job.deleteAfterRun) {
      const idx = this.jobs.indexOf(job);
      if (idx !== -1) this.jobs.splice(idx, 1);
    } else {
      this.computeNextRun(job);
    }

    this.persist();
  }

  private persist(): void {
    saveJobs(this.opts.storePath, this.jobs);
  }
}
