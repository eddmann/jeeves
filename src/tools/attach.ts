/**
 * Attach tool — declares files to send back to the user.
 * Only allows existing files inside the workspace outbox/ directory.
 */

import { existsSync } from "fs";
import { resolve, normalize } from "path";
import type { Tool } from "./index";

export function createAttachTool(ctx: { attachments: string[]; workspaceDir: string }): Tool {
  return {
    name: "attach",
    description:
      "Attach a file to send to the user with your response. Write files to outbox/ first, then attach them.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to file relative to workspace (e.g. outbox/chart.png)",
        },
      },
      required: ["path"],
    },
    async execute(input) {
      const raw = input.path as string;
      const outboxDir = resolve(ctx.workspaceDir, "outbox");
      const fullPath = resolve(ctx.workspaceDir, raw);
      const normalizedFull = normalize(fullPath);

      if (!normalizedFull.startsWith(outboxDir + "/") && normalizedFull !== outboxDir) {
        return `Error: path must be inside outbox/. Got: ${raw}`;
      }

      if (!existsSync(normalizedFull)) {
        return `Error: file not found: ${raw}`;
      }

      ctx.attachments.push(raw);
      const filename = raw.split("/").pop() ?? raw;
      return `Attached ${filename}`;
    },
  };
}
