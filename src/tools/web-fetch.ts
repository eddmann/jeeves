/**
 * Web fetching tool with Readability extraction.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { Tool } from "./index";

const MAX_CONTENT_LENGTH = 10000;

export const webFetchTool: Tool = {
  name: "web_fetch",
  description:
    "Fetch a URL and extract readable text content. Useful for reading web pages, documentation, articles.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch",
      },
    },
    required: ["url"],
  },
  async execute(input) {
    const url = input.url as string;
    try {
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
        return `HTTP ${response.status}: ${response.statusText}`;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const html = await response.text();

      // For non-HTML content, return raw text
      if (!contentType.includes("html")) {
        return html.slice(0, MAX_CONTENT_LENGTH);
      }

      // Parse with linkedom and extract with Readability
      const { document } = parseHTML(html);
      const reader = new Readability(document as unknown as Document);
      const article = reader.parse();

      if (article?.textContent) {
        const text = article.textContent.trim();
        if (text.length > MAX_CONTENT_LENGTH) {
          return text.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated]";
        }
        return text;
      }

      // Fallback: extract text from body
      const bodyText = document.body?.textContent?.trim() ?? "";
      if (bodyText.length > MAX_CONTENT_LENGTH) {
        return bodyText.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated]";
      }
      return bodyText || "(No readable content found)";
    } catch (err) {
      return `Error fetching URL: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
