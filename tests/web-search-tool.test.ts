import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { webSearchTool } from "../src/tools/web-search";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeExaSSE(content: { type: string; text: string }[]): string {
  return `event: message\ndata: ${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content },
  })}\n\n`;
}

function makeExaErrorSSE(code: number, message: string): string {
  return `event: message\ndata: ${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    error: { code, message },
  })}\n\n`;
}

function stubFetch(body: string, init?: { status?: number; statusText?: string }) {
  globalThis.fetch = async () =>
    new Response(body, {
      status: init?.status ?? 200,
      statusText: init?.statusText ?? "OK",
    });
}

const EXA_RESULTS = makeExaSSE([
  { type: "text", text: "First result about testing" },
  { type: "text", text: "Second result about testing" },
]);

describe("web search tool", () => {
  test("returns formatted results from Exa response", async () => {
    stubFetch(EXA_RESULTS);
    const result = await webSearchTool.execute({ query: "test query" });
    expect(result).toContain("First result about testing");
    expect(result).toContain("Second result about testing");
  });

  test("returns error on fetch failure", async () => {
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    const result = await webSearchTool.execute({ query: "test" });
    expect(result).toBe("Search error: network down");
  });

  test("returns error on HTTP failure", async () => {
    stubFetch("", { status: 503, statusText: "Service Unavailable" });
    const result = await webSearchTool.execute({ query: "test" });
    expect(result).toBe("Search failed: HTTP 503 Service Unavailable");
  });

  test("returns error on Exa API error", async () => {
    stubFetch(makeExaErrorSSE(-32600, "Invalid request"));
    const result = await webSearchTool.execute({ query: "test" });
    expect(result).toBe("Search failed: Invalid request");
  });

  test("handles empty results", async () => {
    stubFetch(makeExaSSE([]));
    const result = await webSearchTool.execute({ query: "xyzzy nonsense" });
    expect(result).toContain('No results found for "xyzzy nonsense"');
  });

  test("handles SSE parsing error", async () => {
    stubFetch("not a valid SSE response");
    const result = await webSearchTool.execute({ query: "test" });
    expect(result).toContain("Search error:");
  });

  test("sends correct JSON-RPC body with query and count", async () => {
    let capturedBody = "";
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(EXA_RESULTS);
    };
    await webSearchTool.execute({ query: "hello world", count: 3 });
    const parsed = JSON.parse(capturedBody);
    expect(parsed.method).toBe("tools/call");
    expect(parsed.params.name).toBe("web_search_exa");
    expect(parsed.params.arguments.query).toBe("hello world");
    expect(parsed.params.arguments.numResults).toBe(3);
  });

  test("clamps count to max 10", async () => {
    let capturedBody = "";
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(EXA_RESULTS);
    };
    await webSearchTool.execute({ query: "test", count: 50 });
    const parsed = JSON.parse(capturedBody);
    expect(parsed.params.arguments.numResults).toBe(10);
  });

  test("passes AbortSignal for timeout", async () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response(EXA_RESULTS);
    };
    await webSearchTool.execute({ query: "test" });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);
  });
});
