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
        const proc = Bun.spawn(["sh", "-c", command], {
          cwd: workspaceDir,
          env: process.env,
          stderr: "pipe",
        });

        // Manual timeout — Bun.spawn's native timeout option is unreliable on Linux
        let killed = false;
        const timer = setTimeout(() => {
          killed = true;
          proc.kill();
        }, timeout);

        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        clearTimeout(timer);

        const output = (stdout + stderr).trim();

        if (killed) {
          return `[exit code ${exitCode}] (timeout after ${timeout}ms)\n${output}`.trim();
        }
        if (exitCode !== 0) {
          return `[exit code ${exitCode}]\n${output}`;
        }
        return output || "(no output)";
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
