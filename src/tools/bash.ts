/**
 * Shell command execution tool.
 */

import type { Tool } from "./index";

export function createBashTool(workspaceDir: string): Tool {
  return {
    name: "bash",
    description:
      "Execute a shell command. Returns stdout and stderr combined. Use for running programs, scripts, git commands, etc. Working directory is the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
        },
      },
      required: ["command"],
    },
    async execute(input) {
      const command = input.command as string;
      const timeout = (input.timeout as number) ?? 30000;

      try {
        const proc = Bun.spawnSync(["sh", "-c", command], {
          cwd: workspaceDir,
          timeout,
          env: process.env,
        });

        const stdout = proc.stdout?.toString() ?? "";
        const stderr = proc.stderr?.toString() ?? "";
        const output = (stdout + stderr).trim();

        if (proc.exitCode !== 0) {
          return `[exit code ${proc.exitCode}]\n${output}`;
        }
        return output || "(no output)";
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
