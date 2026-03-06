import { describe, test, expect } from "bun:test";
import { ensureValidMessages, appendOrPushUserText, type LLMMessage } from "../src/llm";
import {
  buildUserMessage,
  buildAssistantMessage,
  buildToolResultMessage,
} from "./helpers/factories";

describe("ensureValidMessages", () => {
  test("passes through valid alternating messages", () => {
    const messages: LLMMessage[] = [
      buildUserMessage("hi"),
      buildAssistantMessage("hello"),
      buildUserMessage("bye"),
    ];

    const result = ensureValidMessages(messages);

    expect(result).toEqual(messages);
  });

  test("returns empty array for empty input", () => {
    expect(ensureValidMessages([])).toEqual([]);
  });

  test("merges consecutive user messages", () => {
    const messages: LLMMessage[] = [buildUserMessage("first"), buildUserMessage("second")];

    const result = ensureValidMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toEqual([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
  });

  test("merges consecutive assistant messages", () => {
    const messages: LLMMessage[] = [
      buildUserMessage("hi"),
      buildAssistantMessage("part 1"),
      buildAssistantMessage("part 2"),
      buildUserMessage("ok"),
    ];

    const result = ensureValidMessages(messages);

    expect(result).toHaveLength(3);
    expect(result[1].role).toBe("assistant");
    expect(result[1].content).toEqual([
      { type: "text", text: "part 1" },
      { type: "text", text: "part 2" },
    ]);
  });

  test("strips trailing assistant messages", () => {
    const messages: LLMMessage[] = [buildUserMessage("hi"), buildAssistantMessage("hello")];

    const result = ensureValidMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
  });

  test("strips multiple trailing assistant messages", () => {
    const messages: LLMMessage[] = [
      buildUserMessage("hi"),
      buildAssistantMessage("one"),
      buildUserMessage("ok"),
      buildAssistantMessage("two"),
      buildAssistantMessage("three"),
    ];

    const result = ensureValidMessages(messages);

    expect(result).toHaveLength(3);
    expect(result[result.length - 1].role).toBe("user");
  });

  test("merges consecutive user messages with content blocks", () => {
    const messages: LLMMessage[] = [
      buildToolResultMessage([{ tool_use_id: "t1", content: "result" }]),
      buildUserMessage("flush prompt"),
    ];

    const result = ensureValidMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(Array.isArray(result[0].content)).toBe(true);
    const blocks = result[0].content as Array<{ type: string }>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("tool_result");
    expect(blocks[1].type).toBe("text");
  });

  test("does not mutate input array", () => {
    const messages: LLMMessage[] = [buildUserMessage("hi"), buildAssistantMessage("bye")];
    const original = [...messages];

    ensureValidMessages(messages);

    expect(messages).toEqual(original);
  });
});

describe("appendOrPushUserText", () => {
  test("pushes new user message when history ends with assistant", () => {
    const messages: LLMMessage[] = [buildUserMessage("hi"), buildAssistantMessage("hello")];

    const result = appendOrPushUserText(messages, "follow up");

    expect(result).not.toBeNull();
    expect(messages).toHaveLength(3);
    expect(messages[2].role).toBe("user");
    expect(messages[2].content).toBe("follow up");
  });

  test("merges into existing user message with string content", () => {
    const messages: LLMMessage[] = [buildUserMessage("first")];

    const result = appendOrPushUserText(messages, "second");

    expect(result).toBeNull();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("first\n\nsecond");
  });

  test("merges into existing user message with content blocks", () => {
    const messages: LLMMessage[] = [
      buildToolResultMessage([{ tool_use_id: "t1", content: "result" }]),
    ];

    const result = appendOrPushUserText(messages, "flush prompt");

    expect(result).toBeNull();
    expect(messages).toHaveLength(1);
    const blocks = messages[0].content as Array<{ type: string }>;
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({ type: "text", text: "flush prompt" });
  });

  test("pushes new message when history is empty", () => {
    const messages: LLMMessage[] = [];

    const result = appendOrPushUserText(messages, "hello");

    expect(result).not.toBeNull();
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });
});
