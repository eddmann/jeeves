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
import { log } from "./logger";

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

  // Build system prompt
  const systemBlocks: Array<{ type: "text"; text: string }> = [];
  if (isOAuth) {
    systemBlocks.push({ type: "text", text: getStealthSystemPrefix() });
  }
  if (opts.systemPrompt) {
    systemBlocks.push({ type: "text", text: opts.systemPrompt });
  }

  // Remap tool names for OAuth mode
  const tools = opts.tools.map((t) => ({
    name: isOAuth ? toClaudeCodeToolName(t.name) : t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

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
    response = await stream.finalMessage();
  } catch (err) {
    const status = (err as { status?: number }).status;
    log.error("llm", "API error", { status, message: String(err) });
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
  });

  return {
    text,
    toolCalls,
    stopReason: response.stop_reason ?? "end_turn",
  };
}
