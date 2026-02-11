/**
 * Progress updates for long-running agent iterations.
 */

export interface ProgressUpdate {
  type: "thinking" | "tool_running";
  iteration: number;
  toolName?: string;
  toolIndex?: number;
  toolCount?: number;
}

const TOOL_LABELS: Record<string, string> = {
  bash: "Running command",
  read: "Reading file",
  write: "Writing file",
  edit: "Editing file",
  webfetch: "Fetching web page",
  web_search: "Searching the web",
  cron: "Managing schedule",
  memory_search: "Searching memory",
};

export function formatProgress(update: ProgressUpdate): string {
  if (update.type === "thinking") {
    return update.iteration === 1 ? "Thinking..." : `Thinking... (step ${update.iteration})`;
  }
  const label = TOOL_LABELS[update.toolName ?? ""] ?? `Running ${update.toolName}`;
  const suffix = (update.toolCount ?? 0) > 1 ? ` (${update.toolIndex}/${update.toolCount})` : "";
  return `${label}${suffix}`;
}
