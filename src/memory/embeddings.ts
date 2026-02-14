/**
 * OpenAI embedding wrapper with batching.
 */

import OpenAI from "openai";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const BATCH_SIZE = 100;
const MODEL = "text-embedding-3-small";
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 2_000;

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

      let success = false;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await client.embeddings.create(
            { model: MODEL, input: batch },
            { signal: AbortSignal.timeout(TIMEOUT_MS) },
          );

          // Sort by index to preserve order
          const sorted = response.data.sort((a, b) => a.index - b.index);
          for (const item of sorted) {
            results.push(item.embedding);
          }
          success = true;
          break;
        } catch {
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          }
        }
      }

      if (!success) {
        throw new Error(`Embedding batch failed after ${MAX_RETRIES + 1} attempts`);
      }
    }

    return results;
  };
}
