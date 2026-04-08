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

export const THINKING_MESSAGES = [
  "One moment, sir...",
  "Considering the matter...",
  "Weighing the options...",
];

export const THINKING_EXTENDED_MESSAGES = [
  "Still attending to the matter...",
  "A moment longer, if you'll permit...",
  "Bearing with the complexity...",
];

export const TOOL_MESSAGES: Record<string, string[]> = {
  bash: ["Attending to a small matter...", "Making arrangements...", "Seeing to something..."],
  read: ["Consulting the records...", "Reviewing the particulars...", "Examining the details..."],
  write: [
    "Noting something down...",
    "Preparing a document...",
    "Committing a few thoughts to paper...",
  ],
  edit: ["Making a small adjustment...", "Applying a correction...", "A minor amendment..."],
  web_fetch: [
    "Making enquiries...",
    "Consulting an outside source...",
    "Gathering intelligence...",
  ],
  web_search: [
    "Conducting a discreet enquiry...",
    "Researching the matter...",
    "Casting a wider net...",
  ],
  cron: ["Arranging the schedule...", "Seeing to the diary...", "Making a note in the calendar..."],
  memory_search: [
    "Consulting my recollections...",
    "If memory serves...",
    "Casting my mind back...",
  ],
};

export const FALLBACK_MESSAGES = ["Attending to something...", "One moment..."];

function pickRandom(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

export function formatProgress(update: ProgressUpdate): string {
  if (update.type === "thinking") {
    return update.iteration === 1
      ? pickRandom(THINKING_MESSAGES)
      : pickRandom(THINKING_EXTENDED_MESSAGES);
  }
  const messages = TOOL_MESSAGES[update.toolName ?? ""] ?? FALLBACK_MESSAGES;
  return pickRandom(messages);
}
