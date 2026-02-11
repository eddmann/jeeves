/**
 * File editing tool with find-and-replace.
 */

import { isAbsolute, resolve } from "path";
import type { Tool } from "./index";

export function createEditFileTool(workspaceDir: string): Tool {
  return {
    name: "edit",
    description:
      "Edit a file by replacing exact text. Use for targeted changes instead of rewriting the entire file. Relative paths resolve from workspace directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to edit (relative paths resolve from workspace)",
        },
        old_string: {
          type: "string",
          description: "Exact text to find in the file",
        },
        new_string: {
          type: "string",
          description: "Text to replace with",
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences (default: false, replaces first only)",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
    async execute(input) {
      const rawPath = input.path as string;
      const path = isAbsolute(rawPath) ? rawPath : resolve(workspaceDir, rawPath);
      const oldString = input.old_string as string;
      const newString = input.new_string as string;
      const replaceAll = (input.replace_all as boolean) ?? false;

      try {
        const file = Bun.file(path);
        if (!(await file.exists())) {
          return `Error: file not found: ${path}`;
        }

        const content = await file.text();

        if (!content.includes(oldString)) {
          const preview = content.split("\n").slice(0, 20).join("\n");
          return `Error: old_string not found in ${path}. First 20 lines:\n${preview}`;
        }

        const count = content.split(oldString).length - 1;
        if (count > 1 && !replaceAll) {
          return `Error: found ${count} occurrences of old_string. Provide more context to make it unique, or set replace_all to true.`;
        }

        const newContent = replaceAll
          ? content.replaceAll(oldString, newString)
          : content.replace(oldString, newString);

        await Bun.write(path, newContent);
        const replaced = replaceAll ? count : 1;
        return `Replaced ${replaced} occurrence${replaced > 1 ? "s" : ""} in ${path}`;
      } catch (err) {
        return `Error editing file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
