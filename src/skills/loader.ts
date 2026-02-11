/**
 * Skill discovery and loading from directories.
 * Skills are SKILL.md files with YAML frontmatter.
 */

import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join, basename, dirname } from "path";
import { parse as parseYaml } from "yaml";
import { log, formatError } from "../logger";

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
}

const SKILL_NAME_RE = /^[a-z0-9-]+$/;
export const MAX_NAME_LENGTH = 64;

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns null if no valid frontmatter found.
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return parseYaml(match[1]);
  } catch {
    return null;
  }
}

/**
 * Recursively find all SKILL.md files in a directory.
 */
function findSkillFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findSkillFiles(fullPath));
    } else if (entry === "SKILL.md") {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Load skills from multiple directories.
 * Later directories override earlier ones (workspace overrides bundled).
 */
export function loadSkillsFromDirs(dirs: string[]): Skill[] {
  const skillMap = new Map<string, Skill>();

  for (const dir of dirs) {
    const skillFiles = findSkillFiles(dir);
    for (const filePath of skillFiles) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const frontmatter = parseFrontmatter(content);
        if (!frontmatter) {
          log.warn("skills", "Skipped: no valid frontmatter", { path: filePath });
          continue;
        }

        const name = frontmatter.name as string;
        const description = frontmatter.description as string;

        if (!name || !description) {
          log.warn("skills", "Skipped: missing name or description", { path: filePath });
          continue;
        }

        if (!SKILL_NAME_RE.test(name)) {
          log.warn("skills", "Skipped: invalid name", { path: filePath, name });
          continue;
        }

        if (name.length > MAX_NAME_LENGTH) {
          log.warn("skills", "Skipped: name too long", { path: filePath, name });
          continue;
        }

        // Validate name matches parent directory
        const parentDir = basename(dirname(filePath));
        if (parentDir !== name) {
          log.warn("skills", "Skipped: name/dir mismatch", {
            path: filePath,
            name,
            dir: parentDir,
          });
          continue;
        }

        skillMap.set(name, {
          name,
          description,
          filePath,
          baseDir: dirname(filePath),
        });
      } catch (err) {
        log.warn("skills", "Error loading skill", { path: filePath, ...formatError(err) });
      }
    }
  }

  return Array.from(skillMap.values());
}
