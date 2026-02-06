import type { LLMResponse } from "../../src/llm";
import type { Skill } from "../../src/skills/loader";
import type { WorkspaceFile } from "../../src/workspace/loader";
import type { CronJob } from "../../src/cron/store";
import type { Tool } from "../../src/tools/index";

export function buildUserMessage(text: string): LLMMessage {
  return { role: "user", content: text };
}

export function buildAssistantMessage(text: string): LLMMessage {
  return { role: "assistant", content: text };
}

export function buildToolUseMessage(
  calls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
): LLMMessage {
  return {
    role: "assistant",
    content: calls.map((c) => ({
      type: "tool_use" as const,
      id: c.id,
      name: c.name,
      input: c.input,
    })),
  };
}

export function buildToolResultMessage(
  results: Array<{ tool_use_id: string; content: string }>,
): LLMMessage {
  return {
    role: "user",
    content: results.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.tool_use_id,
      content: r.content,
    })),
  };
}

export function buildLLMResponse(overrides?: Partial<LLMResponse>): LLMResponse {
  return {
    text: overrides?.text ?? "Hello",
    toolCalls: overrides?.toolCalls ?? [],
    stopReason: overrides?.stopReason ?? "end_turn",
  };
}

export function buildSkill(overrides?: Partial<Skill>): Skill {
  return {
    name: overrides?.name ?? "test-skill",
    description: overrides?.description ?? "A test skill",
    filePath: overrides?.filePath ?? "/tmp/skills/test-skill/SKILL.md",
    baseDir: overrides?.baseDir ?? "/tmp/skills/test-skill",
  };
}

export function buildWorkspaceFile(name: string, content: string): WorkspaceFile {
  return { name, content };
}

export function buildCronJob(overrides?: Partial<CronJob>): CronJob {
  return {
    id: overrides?.id ?? "test-id",
    name: overrides?.name ?? "test-job",
    enabled: overrides?.enabled ?? true,
    deleteAfterRun: overrides?.deleteAfterRun ?? false,
    schedule: overrides?.schedule ?? { kind: "every", everyMs: 60000 },
    message: overrides?.message ?? "do something",
    createdAtMs: overrides?.createdAtMs ?? Date.now(),
    nextRunAtMs: overrides?.nextRunAtMs,
    lastRunAtMs: overrides?.lastRunAtMs,
    lastStatus: overrides?.lastStatus,
  };
}

export function buildStubTool(
  name: string,
  result: string = "ok",
): Tool & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    name,
    description: `Stub tool: ${name}`,
    inputSchema: { type: "object", properties: {} },
    async execute(input: Record<string, unknown>) {
      calls.push(input);
      return result;
    },
    calls,
  };
}
