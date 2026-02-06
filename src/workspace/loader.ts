/**
 * Workspace file loading and initialization.
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, copyFileSync, writeFileSync } from "fs";
import { join } from "path";

export const CONVENTION_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "MEMORY.md",
  "HEARTBEAT.md",
] as const;

export interface WorkspaceFile {
  name: string;
  content: string;
}

const MAX_FILE_SIZE = 20000;

/**
 * Truncate content to a max size, preserving head and tail.
 * 70% head + marker + 20% tail
 */
function truncateContent(content: string, max: number): string {
  if (content.length <= max) return content;
  const headSize = Math.floor(max * 0.7);
  const tailSize = Math.floor(max * 0.2);
  const marker = `\n\n... [truncated ${content.length - headSize - tailSize} chars] ...\n\n`;
  return content.slice(0, headSize) + marker + content.slice(-tailSize);
}

/**
 * Load convention files from the workspace directory.
 */
export function loadWorkspaceFiles(workspaceDir: string): WorkspaceFile[] {
  const files: WorkspaceFile[] = [];

  for (const name of CONVENTION_FILES) {
    const filePath = join(workspaceDir, name);
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, "utf-8");
        files.push({
          name,
          content: truncateContent(raw, MAX_FILE_SIZE),
        });
      } catch {
        // Skip unreadable files
      }
    }
  }

  return files;
}

/**
 * Initialize a workspace directory from templates if it doesn't exist or is empty.
 */
export function initWorkspace(workspaceDir: string, templateDir: string): void {
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(workspaceDir, "skills"), { recursive: true });
  mkdirSync(join(workspaceDir, "memory"), { recursive: true });
  mkdirSync(join(workspaceDir, "sessions"), { recursive: true });
  mkdirSync(join(workspaceDir, "cron"), { recursive: true });

  // Seed .env if it doesn't exist
  const envPath = join(workspaceDir, ".env");
  if (!existsSync(envPath)) {
    writeFileSync(envPath, "# Workspace secrets — skill API keys, tokens, etc.\n", "utf-8");
  }

  // Only copy templates if convention files don't exist yet
  if (!existsSync(templateDir)) return;

  const templates = readdirSync(templateDir).filter((f) => f.endsWith(".md"));
  for (const tmpl of templates) {
    const dest = join(workspaceDir, tmpl);
    if (!existsSync(dest)) {
      copyFileSync(join(templateDir, tmpl), dest);
    }
  }
}

/**
 * Load workspace .env file into process.env.
 * Does not override existing variables.
 */
export function loadWorkspaceEnv(workspaceDir: string): void {
  const envPath = join(workspaceDir, ".env");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
