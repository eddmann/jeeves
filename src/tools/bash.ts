/**
 * Shell command execution tool.
 */

import type { Tool } from "./index";

const MAX_OUTPUT_CHARS = 100_000;

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

        let timer: Timer;
        const readOutput = Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]).then(([stdout, stderr, exitCode]): string => {
          clearTimeout(timer);
          const output = (stdout + stderr).trim();
          if (exitCode !== 0) return `[exit code ${exitCode}]\n${output}`;
          return output || "(no output)";
        });

        const timeoutPromise = new Promise<string>((resolve) => {
          timer = setTimeout(() => {
            proc.kill();
            resolve(`Error: command timed out after ${timeout}ms`);
          }, timeout);
        });

        const result = await Promise.race([readOutput, timeoutPromise]);
        if (result.length > MAX_OUTPUT_CHARS) {
          const half = Math.floor(MAX_OUTPUT_CHARS / 2);
          const omitted = result.length - MAX_OUTPUT_CHARS;
          return (
            result.slice(0, half) +
            `\n\n[... ${omitted} characters omitted ...]\n\n` +
            result.slice(-half)
          );
        }
        return result;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
