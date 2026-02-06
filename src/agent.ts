/**
 * Agent loop — orchestrates LLM calls with tool execution.
 */

import type { AuthStorage } from "./auth/storage";
import { callLLM, type LLMContentBlock } from "./llm";
import type { Tool } from "./tools/index";
import type { Skill } from "./skills/loader";
import type { WorkspaceFile } from "./workspace/loader";
import { buildSystemPrompt } from "./workspace/prompt";
import { formatSkillsForPrompt } from "./skills/prompt";
import type { SessionStore } from "./session";
import { log } from "./logger";
import type { ProgressUpdate } from "./progress";

export const MAX_ITERATIONS = 25;

export interface AgentContext {
  authStorage: AuthStorage;
  tools: Tool[];
  skills: Skill[];
  workspaceFiles: WorkspaceFile[];
  sessionStore: SessionStore;
  sessionKey: string;
  callLLM?: typeof callLLM;
}

export async function runAgent(
  ctx: AgentContext,
  userMessage: string,
  onProgress?: (update: ProgressUpdate) => Promise<void>,
): Promise<string> {
  log.info("agent", "Processing message", {
    session: ctx.sessionKey,
    preview: userMessage.slice(0, 100),
  });

  // Load history
  const history = ctx.sessionStore.get(ctx.sessionKey);

  // Build system prompt
  const skillsPrompt = formatSkillsForPrompt(ctx.skills);
  const systemPrompt = buildSystemPrompt({
    workspaceFiles: ctx.workspaceFiles,
    skillsPrompt,
    isOAuth: ctx.authStorage.isOAuth(),
  });

  // Append user message
  history.push({ role: "user", content: userMessage });

  // Build tools for LLM
  const llmTools = ctx.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  // Tool lookup
  const toolMap = new Map(ctx.tools.map((t) => [t.name, t]));

  // Agent loop
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    log.info("agent", "LLM iteration", { iteration: i + 1 });
    await onProgress?.({ type: "thinking", iteration: i + 1 });
    const llmFn = ctx.callLLM ?? callLLM;
    const response = await llmFn({
      messages: history,
      tools: llmTools,
      systemPrompt,
      authStorage: ctx.authStorage,
    });

    // Build assistant content blocks
    const assistantContent: LLMContentBlock[] = [];
    if (response.text) {
      assistantContent.push({ type: "text", text: response.text });
    }
    for (const tc of response.toolCalls) {
      assistantContent.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }

    history.push({
      role: "assistant",
      content:
        assistantContent.length === 1 && assistantContent[0].type === "text"
          ? assistantContent[0].text
          : assistantContent,
    });

    // If no tool calls, we're done
    if (response.stopReason === "end_turn" || response.toolCalls.length === 0) {
      log.info("agent", "Complete", { iterations: i + 1, stopReason: response.stopReason });
      ctx.sessionStore.set(ctx.sessionKey, history);
      return response.text;
    }

    // Execute tool calls
    const toolResults: LLMContentBlock[] = [];
    for (let j = 0; j < response.toolCalls.length; j++) {
      const tc = response.toolCalls[j];
      log.debug("agent", "Tool call", { name: tc.name, input: tc.input });
      await onProgress?.({
        type: "tool_running",
        iteration: i + 1,
        toolName: tc.name,
        toolIndex: j + 1,
        toolCount: response.toolCalls.length,
      });
      const tool = toolMap.get(tc.name);
      let result: string;
      const toolStart = Date.now();
      if (tool) {
        try {
          result = await tool.execute(tc.input);
        } catch (err) {
          result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        result = `Unknown tool: ${tc.name}`;
      }
      log.debug("agent", "Tool result", {
        name: tc.name,
        chars: result.length,
        ms: Date.now() - toolStart,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: result,
      });
    }

    history.push({ role: "user", content: toolResults });
  }

  // Max iterations reached
  log.warn("agent", "Max iterations reached", { max: MAX_ITERATIONS });
  ctx.sessionStore.set(ctx.sessionKey, history);
  return "(Agent reached maximum iterations)";
}
