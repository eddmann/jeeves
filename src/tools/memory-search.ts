/**
 * Memory search tool — semantic search over long-term memory and session transcripts.
 */

import type { Tool } from "./index";
import type { MemoryIndex } from "../memory/index";

export function createMemorySearchTool(memoryIndex: MemoryIndex): Tool {
  return {
    name: "memory_search",
    description:
      "Semantically search long-term memory files and past session transcripts. " +
      "Use this to recall previous conversations, decisions, facts, or context. " +
      "Returns relevant snippets ranked by relevance.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 6)",
        },
      },
      required: ["query"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
      const query = input.query as string;
      const maxResults = (input.max_results as number) || 6;

      if (!query || typeof query !== "string") {
        return "Error: query is required and must be a string.";
      }

      try {
        const results = await memoryIndex.search(query, maxResults);

        if (results.length === 0) {
          return "No matching memories found.";
        }

        const formatted = results.map((r, i) => {
          const location = `${r.filePath}:${r.startLine}-${r.endLine}`;
          const score = (r.score * 100).toFixed(0);
          return `[${i + 1}] ${location} (${score}% match)\n${r.text}`;
        });

        return formatted.join("\n\n---\n\n");
      } catch (err) {
        return `Memory search error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
