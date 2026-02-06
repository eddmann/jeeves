/**
 * Tool system - registry of all available tools.
 */

import type { CronScheduler } from "../cron/scheduler";
import { createBashTool } from "./bash";
import { createReadFileTool } from "./read-file";
import { createWriteFileTool } from "./write-file";
import { webFetchTool } from "./web-fetch";
import { createCronTool } from "./cron";

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<string>;
}

export function allTools(opts: { cronScheduler: CronScheduler; workspaceDir: string }): Tool[] {
  return [
    createBashTool(opts.workspaceDir),
    createReadFileTool(opts.workspaceDir),
    createWriteFileTool(opts.workspaceDir),
    webFetchTool,
    createCronTool(opts.cronScheduler),
  ];
}
