/**
 * Tool system - registry of all available tools.
 */

import type { CronScheduler } from "../cron/scheduler";
import type { MemoryIndex } from "../memory/index";
import { createBashTool } from "./bash";
import { createReadFileTool } from "./read-file";
import { createWriteFileTool } from "./write-file";
import { createEditFileTool } from "./edit-file";
import { webFetchTool } from "./web-fetch";
import { webSearchTool } from "./web-search";
import { createCronTool } from "./cron";
import { createMemorySearchTool } from "./memory-search";

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<string>;
}

export function allTools(opts: {
  cronScheduler: CronScheduler;
  workspaceDir: string;
  memoryIndex: MemoryIndex;
}): Tool[] {
  return [
    createBashTool(opts.workspaceDir),
    createReadFileTool(opts.workspaceDir),
    createWriteFileTool(opts.workspaceDir),
    createEditFileTool(opts.workspaceDir),
    webFetchTool,
    webSearchTool,
    createCronTool(opts.cronScheduler),
    createMemorySearchTool(opts.memoryIndex),
  ];
}
