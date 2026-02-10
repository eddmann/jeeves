/**
 * OpenAI embedding wrapper with batching.
 */

import OpenAI from "openai";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const BATCH_SIZE = 100;
const MODEL = "text-embedding-3-small";

/** Create a no-op embedder that returns empty results (FTS5 keyword search only). */
export function createNoOpEmbedder(): EmbedFn {
  return async () => [];
}

/** Create an embedder function using OpenAI's text-embedding-3-small model. */
export function createOpenAIEmbedder(apiKey: string): EmbedFn {
  const client = new OpenAI({ apiKey });

  return async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await client.embeddings.create(
        { model: MODEL, input: batch },
        { signal: AbortSignal.timeout(10_000) },
      );

      // Sort by index to preserve order
      const sorted = response.data.sort((a, b) => a.index - b.index);
      for (const item of sorted) {
        results.push(item.embedding);
      }
    }

    return results;
  };
}
