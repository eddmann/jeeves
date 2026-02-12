/**
 * Structured logger — writes JSONL to daily rotating log files.
 * No console output; use console.error directly for human-facing messages.
 */

import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVELS;

class Logger {
  readonly level: LogLevel;
  private threshold: number;
  private logDir: string | null;

  constructor(level: LogLevel = "info", logDir: string | null = null) {
    this.level = level;
    this.threshold = LEVELS[level];
    this.logDir = logDir;
    if (logDir && !existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  debug(cat: string, msg: string, data?: Record<string, unknown>): void {
    this.write("debug", cat, msg, data);
  }

  info(cat: string, msg: string, data?: Record<string, unknown>): void {
    this.write("info", cat, msg, data);
  }

  warn(cat: string, msg: string, data?: Record<string, unknown>): void {
    this.write("warn", cat, msg, data);
  }

  error(cat: string, msg: string, data?: Record<string, unknown>): void {
    this.write("error", cat, msg, data);
  }

  private write(level: LogLevel, cat: string, msg: string, data?: Record<string, unknown>): void {
    if (LEVELS[level] < this.threshold) return;
    if (!this.logDir) return;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const filePath = join(this.logDir, `${dateStr}.jsonl`);
    const entry = { ts: now.toISOString(), level, cat, msg, ...data };
    try {
      appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      // Don't crash if log writing fails
    }
  }
}

/** Extract useful fields from an error for structured logging. */
export function formatError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      error: err.message,
      errorType: err.constructor.name,
      stack: err.stack,
      ...("status" in err ? { status: (err as { status: number }).status } : {}),
    };
  }
  return { error: String(err) };
}

// Module-level singleton
export let log = new Logger();

export function initLogger(level: LogLevel, logDir: string): void {
  log = new Logger(level, logDir);
}
