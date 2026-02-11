import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { webSearchTool } from "../src/tools/web-search";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(body: string, init?: { status?: number; statusText?: string }) {
  globalThis.fetch = async () =>
    new Response(body, {
      status: init?.status ?? 200,
      statusText: init?.statusText ?? "OK",
    });
}

const DDG_HTML = `<html><body>
  <div class="result">
    <a class="result__a" href="https://example.com/one">First Result</a>
    <a class="result__snippet">Description of first result</a>
  </div>
  <div class="result">
    <a class="result__a" href="https://example.com/two">Second Result</a>
    <a class="result__snippet">Description of second result</a>
  </div>
  <div class="result">
    <a class="result__a" href="https://example.com/three">Third Result</a>
    <a class="result__snippet">Description of third result</a>
  </div>
</body></html>`;

describe("web search tool", () => {
  test("returns formatted results from valid DDG HTML", async () => {
    stubFetch(DDG_HTML);
    const result = await webSearchTool.execute({ query: "test query" });
    expect(result).toContain("1. First Result");
    expect(result).toContain("https://example.com/one");
    expect(result).toContain("Description of first result");
    expect(result).toContain("2. Second Result");
    expect(result).toContain("3. Third Result");
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

  test("respects count parameter", async () => {
    stubFetch(DDG_HTML);
    const result = await webSearchTool.execute({ query: "test", count: 2 });
    expect(result).toContain("1. First Result");
    expect(result).toContain("2. Second Result");
    expect(result).not.toContain("3. Third Result");
  });

  test("clamps count to max 10", async () => {
    stubFetch(DDG_HTML);
    const result = await webSearchTool.execute({ query: "test", count: 50 });
    // Only 3 results available in HTML, so all 3 should show
    expect(result).toContain("1. First Result");
    expect(result).toContain("2. Second Result");
    expect(result).toContain("3. Third Result");
  });

  test("handles empty results", async () => {
    stubFetch("<html><body><div>No results</div></body></html>");
    const result = await webSearchTool.execute({ query: "xyzzy nonsense" });
    expect(result).toContain('No results found for "xyzzy nonsense"');
  });

  test("encodes query in URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url: string | URL | Request) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return new Response(DDG_HTML);
    };
    await webSearchTool.execute({ query: "hello world" });
    expect(capturedUrl).toContain("q=hello%20world");
  });

  test("sends browser-like headers", async () => {
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response(DDG_HTML);
    };
    await webSearchTool.execute({ query: "test" });
    const headers = capturedHeaders as Record<string, string>;
    expect(headers["User-Agent"]).toContain("Mozilla/5.0");
  });

  test("passes AbortSignal for timeout", async () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response(DDG_HTML);
    };
    await webSearchTool.execute({ query: "test" });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);
  });
});
