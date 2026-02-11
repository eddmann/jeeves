/**
 * Claude Code masquerading for OAuth mode.
 * When using OAuth tokens, requests must look like they come from Claude Code.
 */

const CLAUDE_CODE_VERSION = "2.1.2";

/** Claude Code canonical tool names */
const CLAUDE_CODE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "KillShell",
  "NotebookEdit",
  "Skill",
  "Task",
  "TaskOutput",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
] as const;

const ccToolLookup = new Map(CLAUDE_CODE_TOOLS.map((t) => [t.toLowerCase(), t]));

/**
 * Get headers that mimic Claude Code for OAuth requests.
 */
export function getStealthHeaders(): Record<string, string> {
  return {
    accept: "application/json",
    "anthropic-dangerous-direct-browser-access": "true",
    "anthropic-beta":
      "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,prompt-caching-scope-2026-01-05",
    "user-agent": `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
    "x-app": "cli",
  };
}

/**
 * Get the system prompt prefix required for OAuth mode.
 */
export function getStealthSystemPrefix(): string {
  return "You are Claude Code, Anthropic's official CLI for Claude.";
}

/**
 * Map a tool name to Claude Code's canonical casing.
 * e.g. "bash" -> "Bash", "read" -> "Read", "webfetch" -> "WebFetch"
 */
export function toClaudeCodeToolName(name: string): string {
  return ccToolLookup.get(name.toLowerCase()) ?? name;
}

/**
 * Reverse-map a Claude Code tool name back to the original tool name.
 * Uses the actual tools array to find the original casing.
 */
export function fromClaudeCodeToolName(name: string, tools?: Array<{ name: string }>): string {
  if (tools && tools.length > 0) {
    const lowerName = name.toLowerCase();
    const matched = tools.find((t) => t.name.toLowerCase() === lowerName);
    if (matched) return matched.name;
  }
  return name;
}
