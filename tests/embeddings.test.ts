import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createOpenAIEmbedder, createNoOpEmbedder } from "../src/memory/embeddings";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createNoOpEmbedder", () => {
  test("returns empty array for any input", async () => {
    const embed = createNoOpEmbedder();

    const result = await embed(["hello", "world"]);

    expect(result).toEqual([]);
  });

  test("returns empty array for empty input", async () => {
    const embed = createNoOpEmbedder();

    const result = await embed([]);

    expect(result).toEqual([]);
  });
});

describe("createOpenAIEmbedder", () => {
  test("passes abort signal to fetch for timeout", async () => {
    let capturedSignal: AbortSignal | null | undefined;
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return new Response(
        JSON.stringify({
          object: "list",
          model: "text-embedding-3-small",
          data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const embed = createOpenAIEmbedder("sk-fake-key");
    await embed(["test"]);

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);
  });

  test("timeout abort propagates as an error", async () => {
    globalThis.fetch = async () => {
      throw new DOMException("The operation was aborted", "TimeoutError");
    };

    const embed = createOpenAIEmbedder("sk-fake-key");
    await expect(embed(["test"])).rejects.toThrow();
  });

  test("skips embedding for empty input", async () => {
    const embed = createOpenAIEmbedder("sk-fake-key");

    const result = await embed([]);

    expect(result).toEqual([]);
  });
});
