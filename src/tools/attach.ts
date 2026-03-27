/**
 * Attach tool — declares files to send back to the user.
 */

import type { Tool } from "./index";

export function createAttachTool(ctx: { attachments: string[] }): Tool {
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
      const path = input.path as string;
      ctx.attachments.push(path);
      const filename = path.split("/").pop() ?? path;
      return `Attached ${filename}`;
    },
  };
}
