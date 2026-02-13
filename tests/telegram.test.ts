import { describe, test, expect } from "bun:test";
import {
  markdownToTelegramHTML,
  splitMessage,
  getReplyContext,
  MAX_MESSAGE_LENGTH,
} from "../src/channel/telegram";
import { formatProgress } from "../src/progress";

describe("markdown to Telegram HTML", () => {
  test("converts bold markers to HTML bold tags", () => {
    const result = markdownToTelegramHTML("**bold**");

    expect(result).toBe("<b>bold</b>");
  });

  test("converts italic markers to HTML italic tags", () => {
    const result = markdownToTelegramHTML("*italic*");

    expect(result).toBe("<i>italic</i>");
  });

  test("converts fenced code blocks to pre tags", () => {
    const md = "```js\nconsole.log('hi');\n```";

    const result = markdownToTelegramHTML(md);

    expect(result).toContain("<pre>");
    expect(result).toContain("console.log");
    expect(result).toContain("</pre>");
  });

  test("converts inline code to code tags", () => {
    const result = markdownToTelegramHTML("`code`");

    expect(result).toBe("<code>code</code>");
  });

  test("converts headers to bold tags", () => {
    expect(markdownToTelegramHTML("## Header")).toBe("<b>Header</b>");
    expect(markdownToTelegramHTML("# Title")).toBe("<b>Title</b>");
  });

  test("converts markdown links to HTML anchor tags", () => {
    const result = markdownToTelegramHTML("[click](https://example.com)");

    expect(result).toBe('<a href="https://example.com">click</a>');
  });

  test("escapes HTML entities to prevent injection", () => {
    const result = markdownToTelegramHTML("a < b & c > d");

    expect(result).toContain("&lt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&gt;");
  });

  test("converts markdown tables to aligned monospace pre blocks", () => {
    const md = [
      "| Month | Runs | km |",
      "|-------|------|----|",
      "| January | 13 | 186.5 |",
      "| February | 3 | 36.2 |",
    ].join("\n");

    const result = markdownToTelegramHTML(md);

    expect(result).toContain("<pre>");
    expect(result).toContain("</pre>");
    expect(result).not.toContain("|");
    expect(result).toContain("Month");
    expect(result).toContain("January");
    expect(result).toContain("February");
  });

  test("preserves column alignment in table conversion", () => {
    const md = ["| A | BB |", "|---|---|", "| x | yy |"].join("\n");

    const result = markdownToTelegramHTML(md);

    // Header and data rows should be padded to same widths
    expect(result).toContain("A  BB");
    expect(result).toContain("x  yy");
  });

  test("converts table embedded in surrounding text", () => {
    const md = [
      "Here are the stats:",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "Pretty good!",
    ].join("\n");

    const result = markdownToTelegramHTML(md);

    expect(result).toContain("Here are the stats:");
    expect(result).toContain("<pre>");
    expect(result).toContain("Pretty good!");
  });

  test("handles mixed formatting in a single message", () => {
    const md = "**bold** and *italic* and `code`";

    const result = markdownToTelegramHTML(md);

    expect(result).toContain("<b>bold</b>");
    expect(result).toContain("<i>italic</i>");
    expect(result).toContain("<code>code</code>");
  });
});

describe("message splitting", () => {
  test("returns single chunk for short messages", () => {
    const chunks = splitMessage("Hello world");

    expect(chunks).toEqual(["Hello world"]);
  });

  test("splits at newline boundary when possible", () => {
    const halfMessage = "a".repeat(MAX_MESSAGE_LENGTH / 2);
    const msg = halfMessage + "\n" + halfMessage;

    const chunks = splitMessage(msg);

    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(halfMessage);
  });

  test("splits at space when no good newline exists", () => {
    const nearLimit = "a".repeat(MAX_MESSAGE_LENGTH - 500);
    const overflow = "b".repeat(MAX_MESSAGE_LENGTH - 500);
    const msg = nearLimit + " " + overflow;

    const chunks = splitMessage(msg);

    expect(chunks.length).toBe(2);
  });

  test("hard splits when no whitespace break point exists", () => {
    const doubleLength = MAX_MESSAGE_LENGTH * 2;
    const msg = "x".repeat(doubleLength);

    const chunks = splitMessage(msg);

    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(MAX_MESSAGE_LENGTH);
  });

  test("keeps message as single chunk at exactly the limit", () => {
    const msg = "a".repeat(MAX_MESSAGE_LENGTH);

    const chunks = splitMessage(msg);

    expect(chunks).toEqual([msg]);
  });
});

describe("progress formatting", () => {
  test("shows 'Thinking...' on first iteration", () => {
    const result = formatProgress({ type: "thinking", iteration: 1 });

    expect(result).toBe("Thinking...");
  });

  test("shows step number on subsequent iterations", () => {
    const result = formatProgress({ type: "thinking", iteration: 3 });

    expect(result).toBe("Thinking... (step 3)");
  });

  test("shows descriptive labels for each standard tool", () => {
    const expected: Record<string, string> = {
      bash: "Running command",
      read: "Reading file",
      write: "Writing file",
      edit: "Editing file",
      web_fetch: "Fetching web page",
      web_search: "Searching the web",
      cron: "Managing schedule",
      memory_search: "Searching memory",
    };

    for (const [tool, label] of Object.entries(expected)) {
      const result = formatProgress({
        type: "tool_running",
        iteration: 1,
        toolName: tool,
        toolIndex: 1,
        toolCount: 1,
      });

      expect(result).toBe(label);
    }
  });

  test("shows generic label for unknown tool names", () => {
    const result = formatProgress({
      type: "tool_running",
      iteration: 1,
      toolName: "custom",
      toolIndex: 1,
      toolCount: 1,
    });

    expect(result).toBe("Running custom");
  });

  test("appends index/count suffix when running multiple tools", () => {
    const result = formatProgress({
      type: "tool_running",
      iteration: 1,
      toolName: "bash",
      toolIndex: 2,
      toolCount: 3,
    });

    expect(result).toBe("Running command (2/3)");
  });

  test("omits suffix when running a single tool", () => {
    const result = formatProgress({
      type: "tool_running",
      iteration: 1,
      toolName: "read",
      toolIndex: 1,
      toolCount: 1,
    });

    expect(result).toBe("Reading file");
  });
});

describe("reply context", () => {
  test("returns null for undefined input", () => {
    expect(getReplyContext(undefined)).toBeNull();
  });

  test("returns null for null input", () => {
    expect(getReplyContext(null)).toBeNull();
  });

  test("returns null when message has no text or caption", () => {
    expect(getReplyContext({})).toBeNull();
    expect(getReplyContext({ text: "" })).toBeNull();
  });

  test("formats text reply as [Replying to: <text>]", () => {
    const result = getReplyContext({ text: "Hello world" });

    expect(result).toBe("[Replying to: Hello world]");
  });

  test("uses caption when text is absent", () => {
    const result = getReplyContext({ caption: "Photo caption" });

    expect(result).toBe("[Replying to: Photo caption]");
  });

  test("truncates text longer than 300 chars with ...", () => {
    const long = "a".repeat(400);
    const result = getReplyContext({ text: long });

    expect(result).toBe(`[Replying to: ${"a".repeat(300)}...]`);
  });

  test("does not truncate text at exactly 300 chars", () => {
    const exact = "b".repeat(300);
    const result = getReplyContext({ text: exact });

    expect(result).toBe(`[Replying to: ${"b".repeat(300)}]`);
  });
});
