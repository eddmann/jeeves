/**
 * Session store — persists conversation history as JSONL files.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { LLMMessage } from "./llm";
import { log } from "./logger";

export const MAX_MESSAGES = 50;

export class SessionStore {
  constructor(private sessionsDir: string) {
    mkdirSync(sessionsDir, { recursive: true });
  }

  private pathFor(key: string): string {
    // Sanitize key for filesystem
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.sessionsDir, `${safe}.jsonl`);
  }

  get(key: string): LLMMessage[] {
    const path = this.pathFor(key);
    if (!existsSync(path)) return [];

    try {
      const content = readFileSync(path, "utf-8").trim();
      if (!content) return [];
      const messages = content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as LLMMessage);
      log.debug("session", "Loaded", { key, messages: messages.length });
      return messages;
    } catch {
      return [];
    }
  }

  set(key: string, messages: LLMMessage[]): void {
    // Truncate to max messages, keeping most recent
    const truncated = messages.length > MAX_MESSAGES;
    let trimmed = messages;
    if (truncated) {
      trimmed = trimmed.slice(-MAX_MESSAGES);
      // Don't start with orphaned tool_results — skip forward to a clean boundary
      while (trimmed.length > 0 && this.startsWithToolResult(trimmed[0])) {
        trimmed = trimmed.slice(1);
      }
    }

    const path = this.pathFor(key);
    const content = trimmed.map((m) => JSON.stringify(m)).join("\n") + "\n";
    writeFileSync(path, content, "utf-8");
    log.debug("session", "Saved", { key, messages: trimmed.length, truncated });
  }

  private startsWithToolResult(msg: LLMMessage): boolean {
    if (typeof msg.content === "string") return false;
    return (
      Array.isArray(msg.content) && msg.content.length > 0 && msg.content[0].type === "tool_result"
    );
  }
}
