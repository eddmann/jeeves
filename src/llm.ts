/**
 * LLM client — raw HTTP + SSE to the ChatGPT Codex backend.
 * Uses the Responses API at chatgpt.com/backend-api/codex/responses.
 */

import type { AuthStorage } from "./auth/storage";
import { log, formatError } from "./logger";

export interface LLMMessage {
  role: "user" | "assistant";
  content: string | LLMContentBlock[];
}

export type LLMContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; dataUri: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMResponse {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
  };
}

export class LLMTimeoutError extends Error {
  constructor(message = "LLM request timed out") {
    super(message);
    this.name = "LLMTimeoutError";
  }
}

const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_RESPONSES_PATH = "/codex/responses";
const DEFAULT_MODEL = "gpt-5.4";

/** Convert internal LLMTool to Responses API function format. */
function convertTools(tools: LLMTool[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/** Convert internal LLMMessage[] to Responses API input items. */
function convertMessages(messages: LLMMessage[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  let msgIndex = 0;

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      if (msg.role === "user") {
        output.push({
          role: "user",
          content: [{ type: "input_text", text: msg.content }],
        });
      } else {
        output.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: msg.content, annotations: [] }],
          status: "completed",
          id: `msg_${msgIndex}`,
        });
      }
      msgIndex++;
      continue;
    }

    // Content block array
    if (msg.role === "user") {
      const contentItems: Array<Record<string, unknown>> = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          contentItems.push({ type: "input_text", text: block.text });
        } else if (block.type === "image") {
          contentItems.push({ type: "input_image", image_url: block.dataUri });
        } else if (block.type === "tool_result") {
          // Tool results are top-level items, not nested in user content
          if (contentItems.length > 0) {
            output.push({ role: "user", content: contentItems.splice(0) });
          }
          output.push({
            type: "function_call_output",
            call_id: block.tool_use_id,
            output: block.content,
          });
        }
      }
      if (contentItems.length > 0) {
        output.push({ role: "user", content: contentItems });
      }
    } else {
      // Assistant message with content blocks
      for (const block of msg.content) {
        if (block.type === "text") {
          output.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: block.text, annotations: [] }],
            status: "completed",
            id: `msg_${msgIndex}`,
          });
        } else if (block.type === "tool_use") {
          output.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          });
        }
      }
    }

    msgIndex++;
  }

  return output;
}

/** Parse SSE stream and extract text, tool calls, and usage. */
async function parseSSEStream(response: Response): Promise<{
  text: string;
  toolCalls: LLMResponse["toolCalls"];
  stopReason: string;
  usage: LLMResponse["usage"];
}> {
  let text = "";
  const toolCallMap = new Map<number, { callId: string; name: string; argsJson: string }>();
  let currentToolIndex = -1;
  let stopReason = "end_turn";
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
  };

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const dataStr = line.slice(6);
      if (dataStr === "[DONE]") break;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(dataStr);
      } catch {
        continue;
      }

      const eventType = event.type as string | undefined;
      if (!eventType) continue;

      if (eventType === "response.output_item.added") {
        const item = (event.item as Record<string, unknown>) ?? {};
        if (item.type === "function_call") {
          currentToolIndex++;
          toolCallMap.set(currentToolIndex, {
            callId: (item.call_id as string) ?? "",
            name: (item.name as string) ?? "",
            argsJson: (item.arguments as string) ?? "",
          });
        }
      } else if (eventType === "response.output_text.delta") {
        const delta = (event.delta as string) ?? "";
        if (delta) text += delta;
      } else if (eventType === "response.function_call_arguments.delta") {
        const delta = (event.delta as string) ?? "";
        const tc = toolCallMap.get(currentToolIndex);
        if (tc && delta) tc.argsJson += delta;
      } else if (eventType === "response.function_call_arguments.done") {
        const tc = toolCallMap.get(currentToolIndex);
        if (tc) {
          tc.argsJson = (event.arguments as string) ?? tc.argsJson;
        }
      } else if (eventType === "response.output_item.done") {
        const item = (event.item as Record<string, unknown>) ?? {};
        if (item.type === "message") {
          // Finalize text from completed item
          const content = item.content as Array<Record<string, unknown>> | undefined;
          if (content) {
            const fullText = content
              .map((part) => (part.text as string) ?? (part.refusal as string) ?? "")
              .join("");
            if (fullText) text = fullText;
          }
        } else if (item.type === "function_call") {
          const tc = toolCallMap.get(currentToolIndex);
          if (tc) {
            const argsStr = (item.arguments as string) ?? tc.argsJson;
            tc.argsJson = argsStr;
          }
        }
      } else if (eventType === "response.completed") {
        const resp = (event.response as Record<string, unknown>) ?? {};
        const usageData = (resp.usage ?? event.usage) as Record<string, unknown> | undefined;

        if (usageData) {
          const inputDetails = usageData.input_tokens_details as
            | Record<string, unknown>
            | undefined;
          const cachedTokens = (inputDetails?.cached_tokens as number) ?? 0;
          const totalInput = (usageData.input_tokens as number) ?? 0;
          usage.inputTokens = Math.max(totalInput - cachedTokens, 0);
          usage.outputTokens = (usageData.output_tokens as number) ?? 0;
          usage.cacheReadInputTokens = Math.max(cachedTokens, 0);
        }

        const status = resp.status as string | undefined;
        if (status === "completed") {
          stopReason = toolCallMap.size > 0 ? "tool_use" : "end_turn";
        } else if (status === "incomplete") {
          stopReason = "length";
        } else {
          stopReason = "end_turn";
        }
      } else if (eventType === "response.failed" || eventType === "error") {
        const err = (event.error as Record<string, unknown>) ?? {};
        const message = (err.message as string) ?? String(err) ?? "Request failed";
        throw new Error(`Codex API error: ${message}`);
      }
    }
  }

  // Finalize tool calls
  const toolCalls: LLMResponse["toolCalls"] = [];
  for (const [, tc] of toolCallMap) {
    let input: Record<string, unknown> = {};
    try {
      input = tc.argsJson ? JSON.parse(tc.argsJson) : {};
    } catch {
      input = {};
    }
    toolCalls.push({ id: tc.callId, name: tc.name, input });
  }

  return { text, toolCalls, stopReason, usage };
}

export async function callLLM(opts: {
  messages: LLMMessage[];
  tools: LLMTool[];
  systemPrompt: string;
  authStorage: AuthStorage;
  model?: string;
}): Promise<LLMResponse> {
  const model = opts.model ?? DEFAULT_MODEL;
  const credential = await opts.authStorage.getCredential();
  if (!credential) {
    throw new Error("No authentication configured. Run `jeeves login` to authenticate.");
  }

  // Build payload
  const input = convertMessages(opts.messages);
  const tools = convertTools(opts.tools);

  const payload: Record<string, unknown> = {
    model,
    instructions: opts.systemPrompt || "You are a helpful assistant.",
    input,
    store: false,
    stream: true,
    reasoning: { effort: "none" }, // disable CoT — latency/cost, tool-use loop handles planning
  };

  if (tools.length > 0) {
    payload.tools = tools;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.accessToken}`,
    "Content-Type": "application/json",
    "chatgpt-account-id": credential.accountId,
    "OpenAI-Beta": "responses=experimental",
    originator: "agent",
  };

  log.info("llm", "Request", {
    model,
    messages: opts.messages.length,
    tools: tools.length,
  });

  const llmStart = Date.now();
  const LLM_TIMEOUT_MS = 2 * 60 * 1000;
  const url = `${CODEX_BASE_URL}${CODEX_RESPONSES_PATH}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let result: Awaited<ReturnType<typeof parseSSEStream>>;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Codex API HTTP ${response.status}: ${errorBody}`);
    }

    result = await parseSSEStream(response);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      log.error("llm", "API timeout", { ms: Date.now() - llmStart });
      throw new LLMTimeoutError();
    }
    log.error("llm", "API error", { ms: Date.now() - llmStart, ...formatError(err) });
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  log.info("llm", "Response", {
    stopReason: result.stopReason,
    textChars: result.text.length,
    toolCalls: result.toolCalls.length,
    ms: Date.now() - llmStart,
    usage: result.usage,
  });

  return {
    text: result.text,
    toolCalls: result.toolCalls,
    stopReason: result.stopReason,
    usage: result.usage,
  };
}
