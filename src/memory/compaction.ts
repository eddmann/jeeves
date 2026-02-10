/**
 * Memory compaction — token-based context management with LLM summarization.
 */

import type { LLMContentBlock, LLMMessage, LLMResponse } from "../llm";
import type { AuthStorage } from "../auth/storage";
import { log } from "../logger";

export const CONTEXT_WINDOW = 200_000;
export const RESERVE_FLOOR = 8_192;
export const SOFT_THRESHOLD = 4_000;
const SAFETY_MARGIN = 1.2;
const TARGET_BUDGET_RATIO = 0.5;

/** Estimate tokens for a single message. */
export function estimateMessageTokens(msg: LLMMessage): number {
  let chars: number;
  if (typeof msg.content === "string") {
    chars = msg.content.length;
  } else {
    chars = msg.content.reduce((sum, block) => {
      if (block.type === "text") return sum + block.text.length;
      if (block.type === "tool_result") return sum + block.content.length;
      if (block.type === "tool_use")
        return sum + JSON.stringify(block.input).length + block.name.length;
      return sum;
    }, 0);
  }
  return Math.ceil((chars / 4) * SAFETY_MARGIN);
}

/** Estimate total tokens for a message array. */
export function estimateHistoryTokens(messages: LLMMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/** Returns true when context is approaching capacity. */
export function shouldFlush(totalTokens: number): boolean {
  return totalTokens >= CONTEXT_WINDOW - RESERVE_FLOOR - SOFT_THRESHOLD;
}

/** Returns true when context is over capacity and compaction is needed. */
export function shouldCompact(totalTokens: number): boolean {
  return totalTokens > CONTEXT_WINDOW - RESERVE_FLOOR;
}

/** Build the flush prompt asking Claude to save important context to memory. */
export function buildFlushPrompt(): string {
  const date = new Date().toISOString().split("T")[0];
  return (
    "You are about to run out of conversation context. Review our conversation and save any " +
    "important facts, decisions, ongoing tasks, or context to memory files using write_file. " +
    `Write to \`memory/${date}.md\`. Focus on information that would be lost and would be ` +
    "useful in future conversations."
  );
}

/** Repair orphaned tool_result blocks that have no matching tool_use in the history. */
export function repairOrphanedToolResults(messages: LLMMessage[]): LLMMessage[] {
  // Collect all tool_use IDs
  const toolUseIds = new Set<string>();
  for (const msg of messages) {
    if (typeof msg.content === "string") continue;
    for (const block of msg.content) {
      if (block.type === "tool_use") {
        toolUseIds.add(block.id);
      }
    }
  }

  // Filter out orphaned tool_results
  const repaired: LLMMessage[] = [];
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      repaired.push(msg);
      continue;
    }

    const filteredBlocks = msg.content.filter((block) => {
      if (block.type === "tool_result") {
        return toolUseIds.has(block.tool_use_id);
      }
      return true;
    });

    // Skip messages that became empty after filtering
    if (filteredBlocks.length > 0) {
      repaired.push({ role: msg.role, content: filteredBlocks });
    }
  }

  return repaired;
}

type CallLLMFn = (opts: {
  messages: LLMMessage[];
  tools: never[];
  systemPrompt: string;
  authStorage: AuthStorage;
  model?: string;
}) => Promise<LLMResponse>;

/** Compute adaptive chunk ratio based on average message size. */
function computeAdaptiveChunkRatio(messages: LLMMessage[]): number {
  const totalTokens = estimateHistoryTokens(messages);
  const avgTokensPerMsg = totalTokens / Math.max(messages.length, 1);

  // If messages are large, use smaller chunks to avoid exceeding context
  if (avgTokensPerMsg > 2000) return 0.25;
  if (avgTokensPerMsg > 1000) return 0.3;
  return 0.4;
}

/** Split messages into chunks for summarization. */
function chunkMessages(messages: LLMMessage[]): LLMMessage[][] {
  const chunkRatio = computeAdaptiveChunkRatio(messages);
  const chunkBudget = Math.floor(CONTEXT_WINDOW * chunkRatio);
  const chunks: LLMMessage[][] = [];
  let current: LLMMessage[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    const msgTokens = estimateMessageTokens(msg);
    if (currentTokens + msgTokens > chunkBudget && current.length > 0) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(msg);
    currentTokens += msgTokens;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

/** Format messages into text for summarization. */
function formatMessagesForSummary(messages: LLMMessage[]): string {
  return messages
    .map((msg) => {
      const role = msg.role === "user" ? "User" : "Assistant";
      if (typeof msg.content === "string") {
        return `${role}: ${msg.content}`;
      }
      const textParts = msg.content
        .map((block) => {
          if (block.type === "text") return block.text;
          if (block.type === "tool_use") return `[Tool: ${block.name}]`;
          if (block.type === "tool_result") {
            const preview = block.content.slice(0, 500);
            return `[Tool result: ${preview}${block.content.length > 500 ? "..." : ""}]`;
          }
          return "";
        })
        .filter(Boolean);
      return `${role}: ${textParts.join("\n")}`;
    })
    .join("\n\n");
}

const SUMMARIZE_SYSTEM = `Summarize the following conversation excerpt. Preserve: key decisions, action items, open questions, important facts, user preferences, and any ongoing tasks. Be concise but comprehensive.`;

/** Summarize messages using Claude. Falls back to simple text summary on failure. */
export async function summarizeMessages(opts: {
  messages: LLMMessage[];
  callLLM: CallLLMFn;
  authStorage: AuthStorage;
}): Promise<string> {
  const chunks = chunkMessages(opts.messages);

  try {
    const partialSummaries: string[] = [];

    for (const chunk of chunks) {
      const formatted = formatMessagesForSummary(chunk);
      const response = await opts.callLLM({
        messages: [{ role: "user", content: formatted }],
        tools: [] as never[],
        systemPrompt: SUMMARIZE_SYSTEM,
        authStorage: opts.authStorage,
        model: "claude-sonnet-4-5-20250929",
      });
      if (response.text) {
        partialSummaries.push(response.text);
      }
    }

    // If multiple chunks, merge summaries
    if (partialSummaries.length > 1) {
      const mergePrompt =
        "Merge these partial conversation summaries into a single cohesive summary:\n\n" +
        partialSummaries.map((s, i) => `--- Part ${i + 1} ---\n${s}`).join("\n\n");

      const merged = await opts.callLLM({
        messages: [{ role: "user", content: mergePrompt }],
        tools: [] as never[],
        systemPrompt: SUMMARIZE_SYSTEM,
        authStorage: opts.authStorage,
        model: "claude-sonnet-4-5-20250929",
      });

      return merged.text || partialSummaries.join("\n\n");
    }

    return partialSummaries[0] || fallbackSummary(opts.messages);
  } catch (err) {
    log.warn("compaction", "LLM summarization failed, using fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackSummary(opts.messages);
  }
}

function fallbackSummary(messages: LLMMessage[]): string {
  const userCount = messages.filter((m) => m.role === "user").length;
  const assistantCount = messages.filter((m) => m.role === "assistant").length;
  const toolUses = messages
    .flatMap((m) => (typeof m.content === "string" ? [] : m.content))
    .filter((b): b is LLMContentBlock & { type: "tool_use" } => b.type === "tool_use");

  return (
    `[Conversation summary: ${messages.length} messages ` +
    `(${userCount} user, ${assistantCount} assistant), ` +
    `${toolUses.length} tool calls. Details were compacted to save context.]`
  );
}

/** Compact session by summarizing old messages and keeping recent ones. */
export async function compactSession(opts: {
  messages: LLMMessage[];
  totalTokens: number;
  callLLM: CallLLMFn;
  authStorage: AuthStorage;
}): Promise<{ messages: LLMMessage[]; summary: string }> {
  const targetBudget = Math.floor(CONTEXT_WINDOW * TARGET_BUDGET_RATIO);

  // Find the split point: keep recent messages that fit within budget
  let keptTokens = 0;
  let splitIndex = opts.messages.length;

  for (let i = opts.messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(opts.messages[i]);
    if (keptTokens + msgTokens > targetBudget) {
      splitIndex = i + 1;
      break;
    }
    keptTokens += msgTokens;
    if (i === 0) splitIndex = 0;
  }

  // Ensure we drop at least something
  if (splitIndex === 0) splitIndex = Math.max(1, Math.floor(opts.messages.length / 2));

  const droppedMessages = opts.messages.slice(0, splitIndex);
  let keptMessages = opts.messages.slice(splitIndex);

  // Repair orphaned tool_results in kept messages
  keptMessages = repairOrphanedToolResults(keptMessages);

  // Summarize dropped messages
  const summary = await summarizeMessages({
    messages: droppedMessages,
    callLLM: opts.callLLM,
    authStorage: opts.authStorage,
  });

  // Prepend summary as synthetic user message
  const summaryMessage: LLMMessage = {
    role: "user",
    content: `[Previous conversation summary]\n\n${summary}`,
  };

  const compacted = [summaryMessage, ...keptMessages];

  log.info("compaction", "Session compacted", {
    droppedMessages: droppedMessages.length,
    keptMessages: keptMessages.length,
    summaryTokens: estimateMessageTokens(summaryMessage),
  });

  return { messages: compacted, summary };
}
