/**
 * Cron job persistence — load/save jobs as JSON.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { dirname } from "path";

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  deleteAfterRun: boolean;
  schedule:
    | { kind: "at"; at: string }
    | { kind: "every"; everyMs: number }
    | { kind: "cron"; expr: string; tz?: string };
  message: string;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error";
  createdAtMs: number;
}

export function loadJobs(path: string): CronJob[] {
  if (!existsSync(path)) return [];
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as CronJob[];
  } catch {
    return [];
  }
}

export function saveJobs(path: string, jobs: CronJob[]): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Atomic write: write to tmp, then rename
  const tmpPath = path + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(jobs, null, 2), "utf-8");
  renameSync(tmpPath, path);
}
