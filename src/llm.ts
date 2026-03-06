/**
 * LLM client wrapping @anthropic-ai/sdk.
 * Supports API key and OAuth (stealth) modes.
 */

import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import type { AuthStorage } from "./auth/storage";
import {
  getStealthHeaders,
  getStealthSystemPrefix,
  toClaudeCodeToolName,
  fromClaudeCodeToolName,
} from "./auth/stealth";
import { log, formatError } from "./logger";

export interface LLMMessage {
  role: "user" | "assistant";
  content: string | LLMContentBlock[];
}

export type LLMContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        data: string;
      };
    }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface LLMTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LLMResponse {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

export class LLMTimeoutError extends Error {
  constructor(message = "LLM request timed out") {
    super(message);
    this.name = "LLMTimeoutError";
  }
}

/** Convert message content to a content block array. */
function toBlocks(content: string | LLMContentBlock[]): LLMContentBlock[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

/**
 * Ensure messages alternate user/assistant and end with user.
 * Merges consecutive same-role messages and strips trailing assistant messages.
 * Returns a new array — does not mutate the input.
 */
export function ensureValidMessages(messages: LLMMessage[]): LLMMessage[] {
  if (messages.length === 0) return [];

  // Merge consecutive same-role messages
  const merged: LLMMessage[] = [];
  for (const msg of messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content = [...toBlocks(prev.content), ...toBlocks(msg.content)];
    } else {
      merged.push({ role: msg.role, content: msg.content });
    }
  }

  // Strip trailing assistant messages
  while (merged.length > 0 && merged[merged.length - 1].role === "assistant") {
    merged.pop();
  }

  return merged;
}

/**
 * Append text to the last message if it is a user message, otherwise push a new
 * user message. Returns the new message when one was created, or null if the
 * text was merged into the existing message.
 */
export function appendOrPushUserText(messages: LLMMessage[], text: string): LLMMessage | null {
  const last = messages[messages.length - 1];
  if (last && last.role === "user") {
    if (typeof last.content === "string") {
      last.content = last.content + "\n\n" + text;
    } else {
      last.content.push({ type: "text", text });
    }
    return null;
  }
  const msg: LLMMessage = { role: "user", content: text };
  messages.push(msg);
  return msg;
}

export async function callLLM(opts: {
  messages: LLMMessage[];
  tools: LLMTool[];
  systemPrompt: string;
  authStorage: AuthStorage;
  model?: string;
}): Promise<LLMResponse> {
  const model = opts.model ?? "claude-opus-4-6";
  const credential = await opts.authStorage.getCredential();
  if (!credential) {
    throw new Error("No authentication configured. Run `jeeves login` or set ANTHROPIC_API_KEY.");
  }

  const isOAuth = credential.type === "oauth";

  const clientOpts: ClientOptions = {
    maxRetries: 5,
    logLevel: log.level,
    logger: {
      error: (msg: string, ...args: unknown[]) =>
        log.error("sdk", msg, args[0] as Record<string, unknown>),
      warn: (msg: string, ...args: unknown[]) =>
        log.warn("sdk", msg, args[0] as Record<string, unknown>),
      info: (msg: string, ...args: unknown[]) =>
        log.info("sdk", msg, args[0] as Record<string, unknown>),
      debug: (msg: string, ...args: unknown[]) =>
        log.debug("sdk", msg, args[0] as Record<string, unknown>),
    },
  };
  if (isOAuth) {
    clientOpts.apiKey = null;
    clientOpts.authToken = credential.accessToken;
    clientOpts.defaultHeaders = getStealthHeaders();
    clientOpts.dangerouslyAllowBrowser = true;
  } else {
    clientOpts.apiKey = credential.key;
  }

  const client = new Anthropic(clientOpts);

  // Build system prompt with cache_control on the last block
  const systemBlocks: Anthropic.TextBlockParam[] = [];
  if (isOAuth) {
    systemBlocks.push({ type: "text", text: getStealthSystemPrefix() });
  }
  if (opts.systemPrompt) {
    systemBlocks.push({ type: "text", text: opts.systemPrompt });
  }
  if (systemBlocks.length > 0) {
    systemBlocks[systemBlocks.length - 1].cache_control = { type: "ephemeral" };
  }

  // Remap tool names for OAuth mode, cache_control on last tool
  const tools: Anthropic.Tool[] = opts.tools.map((t) => ({
    name: isOAuth ? toClaudeCodeToolName(t.name) : t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));
  if (tools.length > 0) {
    tools[tools.length - 1].cache_control = { type: "ephemeral" };
  }

  // Sanitize messages: merge consecutive same-role and strip trailing assistant
  const sanitizedMessages = ensureValidMessages(opts.messages);

  // Convert messages
  const messages: Anthropic.MessageParam[] = sanitizedMessages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    return {
      role: m.role,
      content: m.content.map((block): Anthropic.ContentBlockParam => {
        if (block.type === "tool_use" && isOAuth) {
          return { ...block, name: toClaudeCodeToolName(block.name) };
        }
        return block;
      }),
    };
  });

  // Add cache_control on the last message's last content block.
  // Without this, the 20-block lookback window can't reach the system/tools
  // cache breakpoints when conversations grow beyond ~20 messages.
  // First strip any stale markers from prior callLLM iterations (the history
  // array is mutated in place by the agent loop), then set the new one.
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.cache_control) block.cache_control = undefined;
      }
    }
  }
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    if (typeof last.content === "string") {
      last.content = [{ type: "text", text: last.content, cache_control: { type: "ephemeral" } }];
    } else if (Array.isArray(last.content) && last.content.length > 0) {
      last.content[last.content.length - 1].cache_control = { type: "ephemeral" };
    }
  }

  log.info("llm", "Request", {
    model,
    messages: sanitizedMessages.length,
    tools: tools.length,
    isOAuth,
  });

  const llmStart = Date.now();
  const LLM_TIMEOUT_MS = 2 * 60 * 1000;

  // Use streaming (required for OAuth/Claude Code compatibility)
  const stream = client.messages.stream({
    model,
    max_tokens: 8192,
    system: systemBlocks,
    messages,
    tools,
    stream: true,
  });

  let response: Anthropic.Message;
  try {
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new LLMTimeoutError()), LLM_TIMEOUT_MS),
    );
    response = await Promise.race([stream.finalMessage(), timeout]);
  } catch (err) {
    stream.abort();
    log.error("llm", "API error", { ms: Date.now() - llmStart, ...formatError(err) });
    throw err;
  }

  // Extract text and tool calls
  let text = "";
  const toolCalls: LLMResponse["toolCalls"] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      const originalName = isOAuth ? fromClaudeCodeToolName(block.name, opts.tools) : block.name;
      toolCalls.push({
        id: block.id,
        name: originalName,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  log.info("llm", "Response", {
    stopReason: response.stop_reason ?? "end_turn",
    textChars: text.length,
    toolCalls: toolCalls.length,
    ms: Date.now() - llmStart,
    usage: response.usage,
  });

  return {
    text,
    toolCalls,
    stopReason: response.stop_reason ?? "end_turn",
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}
