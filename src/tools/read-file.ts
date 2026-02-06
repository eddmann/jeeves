/**
 * File reading tool with line numbers.
 */

import { resolve, isAbsolute } from "path";
import type { Tool } from "./index";

export function createReadFileTool(workspaceDir: string): Tool {
  return {
    name: "read",
    description:
      "Read the contents of a file. Returns the file content with line numbers. Relative paths resolve from workspace directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Absolute or relative path to the file (relative paths resolve from workspace)",
        },
      },
      required: ["path"],
    },
    async execute(input) {
      const rawPath = input.path as string;
      const path = isAbsolute(rawPath) ? rawPath : resolve(workspaceDir, rawPath);
      try {
        const content = await Bun.file(path).text();
        const lines = content.split("\n");
        return lines.map((line, i) => `${i + 1}\t${line}`).join("\n");
      } catch (err) {
        return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
