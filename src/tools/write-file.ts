/**
 * File writing tool with directory creation.
 */

import { mkdirSync } from "fs";
import { dirname, resolve, isAbsolute } from "path";
import type { Tool } from "./index";

export function createWriteFileTool(workspaceDir: string): Tool {
  return {
    name: "write",
    description:
      "Write content to a file. Creates parent directories if needed. Overwrites existing files. Relative paths resolve from workspace directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Absolute or relative path to write to (relative paths resolve from workspace)",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
    async execute(input) {
      const rawPath = input.path as string;
      const path = isAbsolute(rawPath) ? rawPath : resolve(workspaceDir, rawPath);
      const content = input.content as string;
      try {
        mkdirSync(dirname(path), { recursive: true });
        await Bun.write(path, content);
        return `Wrote ${content.length} bytes to ${path}`;
      } catch (err) {
        return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
