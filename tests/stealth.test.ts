import { describe, test, expect } from "bun:test";
import {
  toClaudeCodeToolName,
  fromClaudeCodeToolName,
  getStealthHeaders,
  getStealthSystemPrefix,
} from "../src/auth/stealth";

describe("OAuth stealth mode", () => {
  describe("tool name remapping", () => {
    test("remaps internal tool names to Claude Code equivalents", () => {
      expect(toClaudeCodeToolName("bash")).toBe("Bash");
      expect(toClaudeCodeToolName("read")).toBe("Read");
      expect(toClaudeCodeToolName("write")).toBe("Write");
      expect(toClaudeCodeToolName("webfetch")).toBe("WebFetch");
    });

    test("leaves unmapped tool names unchanged", () => {
      expect(toClaudeCodeToolName("custom_tool")).toBe("custom_tool");
    });

    test("reverses remapped names back to internal names", () => {
      const tools = [{ name: "bash" }, { name: "read" }, { name: "webfetch" }];

      expect(fromClaudeCodeToolName("Bash", tools)).toBe("bash");
      expect(fromClaudeCodeToolName("Read", tools)).toBe("read");
      expect(fromClaudeCodeToolName("WebFetch", tools)).toBe("webfetch");
    });

    test("returns unknown Claude Code names as-is when no match exists", () => {
      const tools = [{ name: "bash" }];

      expect(fromClaudeCodeToolName("UnknownTool", tools)).toBe("UnknownTool");
    });
  });

  describe("stealth headers", () => {
    test("includes user-agent, beta flag, and app identifier", () => {
      const headers = getStealthHeaders();

      expect(headers).toHaveProperty("user-agent");
      expect(headers).toHaveProperty("anthropic-beta");
      expect(headers).toHaveProperty("x-app");
      expect(headers["x-app"]).toBe("cli");
    });
  });

  describe("stealth system prompt", () => {
    test("identifies as Claude Code", () => {
      expect(getStealthSystemPrefix()).toContain("Claude Code");
    });
  });
});
