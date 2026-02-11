/**
 * Web search tool using DuckDuckGo HTML interface.
 */

import { parseHTML } from "linkedom";
import type { Tool } from "./index";

const MAX_RESULTS = 10;
const DEFAULT_RESULTS = 5;

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web using DuckDuckGo. Returns a list of results with titles, URLs, and snippets.",
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
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-GB,en;q=0.5",
          "Cache-Control": "no-cache",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        return `Search failed: HTTP ${response.status} ${response.statusText}`;
      }

      const html = await response.text();
      const { document } = parseHTML(html);

      const resultElements = document.querySelectorAll(".result__a");
      if (resultElements.length === 0) {
        return `No results found for "${query}"`;
      }

      const results: string[] = [];
      for (let i = 0; i < Math.min(resultElements.length, count); i++) {
        const linkEl = resultElements[i] as unknown as HTMLAnchorElement;
        const title = linkEl.textContent?.trim() ?? "";
        const href = linkEl.getAttribute("href") ?? "";

        const resultItem = linkEl.closest(".result");
        const snippetEl = resultItem?.querySelector(".result__snippet");
        const snippet = snippetEl?.textContent?.trim() ?? "";

        results.push(`${i + 1}. ${title}\n   ${href}\n   ${snippet}`);
      }

      return results.join("\n\n");
    } catch (err) {
      return `Search error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
