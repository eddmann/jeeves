import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { webFetchTool } from "../src/tools/web-fetch";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(
  body: string,
  init?: { status?: number; statusText?: string; headers?: Record<string, string> },
) {
  globalThis.fetch = async () =>
    new Response(body, {
      status: init?.status ?? 200,
      statusText: init?.statusText ?? "OK",
      headers: init?.headers ?? {},
    });
}

describe("web fetch tool", () => {
  test("HTTP error returns status line", async () => {
    stubFetch("", { status: 404, statusText: "Not Found" });
    const result = await webFetchTool.execute({ url: "https://example.com" });
    expect(result).toBe("HTTP 404: Not Found");
  });

  test("non-HTML content returned raw", async () => {
    stubFetch("plain text data", { headers: { "content-type": "text/plain" } });
    const result = await webFetchTool.execute({ url: "https://example.com/data.txt" });
    expect(result).toBe("plain text data");
  });

  test("non-HTML truncated at 10000 chars", async () => {
    const long = "x".repeat(20000);
    stubFetch(long, { headers: { "content-type": "application/json" } });
    const result = await webFetchTool.execute({ url: "https://example.com/data.json" });
    expect(result.length).toBe(10000);
  });

  test("HTML with Readability extracts article", async () => {
    const html = `<html><head><title>Test</title></head><body><article><p>Article content here.</p></article></body></html>`;
    stubFetch(html, { headers: { "content-type": "text/html" } });
    const result = await webFetchTool.execute({ url: "https://example.com" });
    expect(result).toContain("Article content here.");
  });

  test("Readability fallback to body.textContent", async () => {
    // Minimal HTML that Readability won't parse as an article
    const html = `<html><body>Just body text</body></html>`;
    stubFetch(html, { headers: { "content-type": "text/html" } });
    const result = await webFetchTool.execute({ url: "https://example.com" });
    expect(result).toContain("Just body text");
  });

  test("HTML content truncated with marker", async () => {
    const longText = "word ".repeat(5000);
    const html = `<html><head><title>Test</title></head><body><article><p>${longText}</p></article></body></html>`;
    stubFetch(html, { headers: { "content-type": "text/html" } });
    const result = await webFetchTool.execute({ url: "https://example.com" });
    expect(result).toContain("[Content truncated]");
    // 10000 chars + "\n\n[Content truncated]" suffix
    expect(result.length).toBe(10000 + "\n\n[Content truncated]".length);
  });

  test("empty body returns sentinel", async () => {
    const html = `<html><body></body></html>`;
    stubFetch(html, { headers: { "content-type": "text/html" } });
    const result = await webFetchTool.execute({ url: "https://example.com" });
    expect(result).toBe("(No readable content found)");
  });

  test("fetch error returns error string", async () => {
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    const result = await webFetchTool.execute({ url: "https://example.com" });
    expect(result).toBe("Error fetching URL: network down");
  });

  test("correct User-Agent header sent", async () => {
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    };
    await webFetchTool.execute({ url: "https://example.com" });
    const headers = capturedHeaders as Record<string, string>;
    expect(headers["User-Agent"]).toContain("Mozilla/5.0");
  });

  test("passes AbortSignal to fetch for timeout", async () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    };
    await webFetchTool.execute({ url: "https://example.com" });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);
  });

  test("fetch timeout produces error string instead of hanging", async () => {
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      // Simulate an abort by immediately aborting via the signal
      if (init?.signal) {
        const err = new DOMException("The operation was aborted", "TimeoutError");
        throw err;
      }
      throw new Error("unexpected");
    };
    const result = await webFetchTool.execute({ url: "https://example.com" });
    expect(result).toContain("Error fetching URL:");
    expect(result).toContain("aborted");
  });
});
