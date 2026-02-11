/**
 * Heartbeat system — periodic agent check-ins.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { log, formatError } from "./logger";

export class HeartbeatRunner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastSentText: string | null = null;
  private lastSentAt = 0;

  constructor(
    private opts: {
      intervalMs: number;
      workspaceDir: string;
      runAgent: (message: string) => Promise<string>;
      sendToChannel: (text: string) => Promise<void>;
      activeHours?: { start: string; end: string; timezone?: string };
    },
  ) {}

  start(): void {
    log.info("heartbeat", "Started", {
      interval: `${Math.round(this.opts.intervalMs / 60000)}min`,
    });
    this.interval = setInterval(() => this.runOnce(), this.opts.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async runOnce(): Promise<void> {
    try {
      // Check active hours
      if (!this.isWithinActiveHours()) {
        log.info("heartbeat", "Check", { result: "skipped:inactive" });
        return;
      }

      // Check if HEARTBEAT.md exists and has content
      const heartbeatPath = join(this.opts.workspaceDir, "HEARTBEAT.md");
      if (!existsSync(heartbeatPath)) {
        log.info("heartbeat", "Check", { result: "skipped:empty" });
        return;
      }

      const content = readFileSync(heartbeatPath, "utf-8");
      if (this.isEffectivelyEmpty(content)) {
        log.info("heartbeat", "Check", { result: "skipped:empty" });
        return;
      }

      // Run agent with heartbeat prompt
      const prompt =
        "Read HEARTBEAT.md and follow its instructions. If nothing needs attention, reply with exactly HEARTBEAT_OK.";
      const response = await this.opts.runAgent(prompt);
      const trimmed = response.trim();

      // Suppress HEARTBEAT_OK
      if (trimmed === "HEARTBEAT_OK") {
        log.info("heartbeat", "Check", { result: "suppressed:ok" });
        return;
      }

      // Dedup: don't send same message within 24h
      const now = Date.now();
      if (this.lastSentText === trimmed && now - this.lastSentAt < 24 * 60 * 60 * 1000) {
        log.info("heartbeat", "Check", { result: "suppressed:dedup" });
        return;
      }

      // Send to channel
      log.info("heartbeat", "Check", { result: "sent" });
      await this.opts.sendToChannel(response);
      this.lastSentText = trimmed;
      this.lastSentAt = now;
    } catch (err) {
      log.error("heartbeat", "Error", formatError(err));
    }
  }

  private isEffectivelyEmpty(content: string): boolean {
    // Strip comments (lines starting with #) and whitespace
    const lines = content.split("\n");
    const meaningful = lines.filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("#");
    });
    return meaningful.length === 0;
  }

  private isWithinActiveHours(): boolean {
    if (!this.opts.activeHours) return true;

    const { start, end } = this.opts.activeHours;
    const now = new Date();

    // Parse HH:MM
    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }
    // Wraps midnight
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}
