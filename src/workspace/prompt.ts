/**
 * System prompt assembly from workspace files and skills.
 */

import type { WorkspaceFile } from "./loader";

const BASE_IDENTITY = `You are Jeeves, a personal AI assistant. You have access to tools for reading/writing files, executing shell commands, fetching web pages, and managing scheduled tasks.

Be helpful, concise, and proactive. Take action rather than asking for permission on safe operations. Ask before doing anything destructive or externally visible.`;

const SELF_EXTENSION_INSTRUCTIONS = `## Self-Extension

You can extend your own capabilities:
- Create new skills by writing SKILL.md files to the workspace skills/ directory
- Update MEMORY.md with important context to remember across sessions
- Add notes to daily memory files at memory/YYYY-MM-DD.md
- Modify HEARTBEAT.md to set up periodic checks`;

/**
 * Build the full system prompt.
 */
export function buildSystemPrompt(opts: {
  workspaceFiles: WorkspaceFile[];
  skillsPrompt: string;
  isOAuth: boolean;
}): string {
  const sections: string[] = [];

  // Base identity
  sections.push(BASE_IDENTITY);

  // Available tools
  sections.push(`## Tools

You have access to these tools:
- **bash** — Execute shell commands
- **read** — Read file contents with line numbers
- **write** — Write content to files (creates directories)
- **webfetch** — Fetch and extract text from URLs
- **cron** — Manage scheduled jobs (add/list/remove/run/status)`);

  // Skills
  if (opts.skillsPrompt) {
    sections.push(opts.skillsPrompt);
  }

  // Project context from workspace files
  if (opts.workspaceFiles.length > 0) {
    const filesSections = opts.workspaceFiles
      .map((f) => `### ${f.name}\n\n${f.content}`)
      .join("\n\n");
    sections.push(`## Project Context\n\n${filesSections}`);
  }

  // Self-extension instructions
  sections.push(SELF_EXTENSION_INSTRUCTIONS);

  return sections.join("\n\n");
}
