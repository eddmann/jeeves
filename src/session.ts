/**
 * Session store — persists conversation history as JSONL files.
 *
 * Append-only JSONL files per session, with rotation. Compaction appends a
 * marker line followed by compacted messages — on load, only messages after
 * the last marker are returned. When a file exceeds ROTATION_SIZE, a new
 * numbered file is created. Original messages are preserved for indexing.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import type { LLMMessage } from "./llm";
import { log } from "./logger";

const COMPACTION_MARKER = '{"@@compaction":true}';

export const ROTATION_SIZE = 1_000_000;

export class SessionStore {
  constructor(private sessionsDir: string) {
    mkdirSync(sessionsDir, { recursive: true });
  }

  private safeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  /**
   * Returns the path of the active (highest-numbered) session file.
   * Scans for {safe}.{N}.jsonl files; falls back to {safe}.jsonl.
   */
  private activePath(key: string): string {
    const safe = this.safeKey(key);
    const base = `${safe}.jsonl`;
    const prefix = `${safe}.`;
    const suffix = ".jsonl";

    let maxSeq = -1;
    try {
      for (const entry of readdirSync(this.sessionsDir)) {
        if (entry === base) {
          if (maxSeq < 0) maxSeq = 0;
          continue;
        }
        if (entry.startsWith(prefix) && entry.endsWith(suffix) && entry !== base) {
          const middle = entry.slice(prefix.length, -suffix.length);
          const n = Number(middle);
          if (Number.isInteger(n) && n > 0 && n > maxSeq) {
            maxSeq = n;
          }
        }
      }
    } catch {
      // Directory may not exist yet
    }

    if (maxSeq > 0) return join(this.sessionsDir, `${safe}.${maxSeq}.jsonl`);
    return join(this.sessionsDir, base);
  }

  /** Returns the active session file path (for indexing). */
  getPath(key: string): string {
    return this.activePath(key);
  }

  /** Load working history — messages after the last compaction marker. */
  get(key: string): LLMMessage[] {
    const path = this.activePath(key);
    if (!existsSync(path)) return [];

    try {
      const content = readFileSync(path, "utf-8").trim();
      if (!content) return [];

      const lines = content.split("\n").filter((line) => line.trim());

      // Find last compaction marker
      let startIndex = 0;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i] === COMPACTION_MARKER) {
          startIndex = i + 1;
          break;
        }
      }

      const messages = lines.slice(startIndex).map((line) => JSON.parse(line) as LLMMessage);
      log.debug("session", "Loaded", { key, messages: messages.length });
      return messages;
    } catch {
      return [];
    }
  }

  /** Append messages to the session file. */
  append(key: string, messages: LLMMessage[]): void {
    if (messages.length === 0) return;
    const path = this.activePath(key);
    const content = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
    appendFileSync(path, content, "utf-8");
    log.debug("session", "Appended", { key, messages: messages.length });
  }

  /** Compact session — rotate to a new file if the active file is over ROTATION_SIZE. */
  compact(key: string, messages: LLMMessage[]): void {
    const path = this.activePath(key);
    const content = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";

    let fileSize = 0;
    try {
      fileSize = statSync(path).size;
    } catch {
      // File doesn't exist yet — size stays 0
    }

    if (fileSize > ROTATION_SIZE) {
      const safe = this.safeKey(key);
      const prefix = `${safe}.`;
      const suffix = ".jsonl";

      let maxSeq = 0;
      for (const entry of readdirSync(this.sessionsDir)) {
        if (entry.startsWith(prefix) && entry.endsWith(suffix) && entry !== `${safe}.jsonl`) {
          const middle = entry.slice(prefix.length, -suffix.length);
          const n = Number(middle);
          if (Number.isInteger(n) && n > 0 && n > maxSeq) {
            maxSeq = n;
          }
        }
      }

      const nextSeq = maxSeq + 1;
      const newPath = join(this.sessionsDir, `${safe}.${nextSeq}.jsonl`);
      writeFileSync(newPath, content, "utf-8");
      log.info("session", "Rotated", { key, seq: nextSeq, messages: messages.length });
    } else {
      appendFileSync(path, COMPACTION_MARKER + "\n" + content, "utf-8");
      log.info("session", "Compacted", { key, messages: messages.length });
    }
  }
}
