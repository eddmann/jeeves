/**
 * Web search tool using Exa AI neural search via JSON-RPC/SSE.
 */

import type { Tool } from "./index";

const EXA_SEARCH_URL = "https://mcp.exa.ai/mcp";
const MAX_RESULTS = 10;
const DEFAULT_RESULTS = 5;
const CONTEXT_MAX_CHARS = 1024;

interface ExaResponse {
  jsonrpc: "2.0";
  id: number;
  result?: { content?: { type: string; text: string }[] };
  error?: { code: number; message: string };
}

function parseSSEResponse(text: string): string {
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      return line.substring(6);
    }
  }
  throw new Error("No data field found in SSE response");
}

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web using Exa AI. Returns a list of results with titles, URLs, and snippets.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
      count: {
        type: "number",
        description: `Number of results to return (default ${DEFAULT_RESULTS}, max ${MAX_RESULTS})`,
      },
    },
    required: ["query"],
  },
  async execute(input) {
    const query = input.query as string;
    const count = Math.min(Math.max((input.count as number) || DEFAULT_RESULTS, 1), MAX_RESULTS);

    try {
      const response = await fetch(EXA_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: {
            name: "web_search_exa",
            arguments: {
              query,
              numResults: count,
              type: "auto",
              contextMaxCharacters: CONTEXT_MAX_CHARS,
            },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        return `Search failed: HTTP ${response.status} ${response.statusText}`;
      }

      const text = await response.text();
      const jsonData = parseSSEResponse(text);
      const parsed: ExaResponse = JSON.parse(jsonData);

      if (parsed.error) {
        return `Search failed: ${parsed.error.message}`;
      }

      if (!parsed.result?.content?.length) {
        return `No results found for "${query}"`;
      }

      return parsed.result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n\n");
    } catch (err) {
      return `Search error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
