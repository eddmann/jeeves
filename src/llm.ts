/**
 * LLM client wrapping @anthropic-ai/sdk.
 * Supports API key and OAuth (stealth) modes.
 */

import Anthropic from "@anthropic-ai/sdk";
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

  // Build client
  const clientOpts: Record<string, unknown> = {};
  if (isOAuth) {
    clientOpts.apiKey = null;
    clientOpts.authToken = credential.accessToken;
    clientOpts.defaultHeaders = getStealthHeaders();
    clientOpts.dangerouslyAllowBrowser = true;
  } else {
    clientOpts.apiKey = credential.key;
  }

  const client = new Anthropic(clientOpts as ConstructorParameters<typeof Anthropic>[0]);

  // Build system prompt with cache_control on the last block
  const systemBlocks: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }> = [];
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
  const tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    cache_control?: { type: "ephemeral" };
  }> = opts.tools.map((t) => ({
    name: isOAuth ? toClaudeCodeToolName(t.name) : t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  if (tools.length > 0) {
    tools[tools.length - 1].cache_control = { type: "ephemeral" };
  }

  // Convert messages
  const messages = opts.messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    return {
      role: m.role,
      content: m.content.map((block) => {
        if (block.type === "tool_use" && isOAuth) {
          return { ...block, name: toClaudeCodeToolName(block.name) };
        }
        return block;
      }),
    };
  });

  log.info("llm", "Request", {
    model,
    messages: opts.messages.length,
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
    messages: messages as Anthropic.MessageParam[],
    tools: tools as Anthropic.Tool[],
    stream: true,
  });

  let response: Anthropic.Message;
  try {
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("LLM request timed out")), LLM_TIMEOUT_MS),
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
