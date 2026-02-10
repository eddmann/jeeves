import { describe, test, expect } from "bun:test";
import {
  cosineSimilarity,
  buildFtsQuery,
  bm25RankToScore,
  mergeHybridResults,
  type SearchHit,
} from "../src/memory/hybrid";

describe("cosineSimilarity", () => {
  test("returns 1 for identical vectors", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  test("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0, 5);
  });

  test("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5);
  });

  test("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  test("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  test("handles zero vector", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});

describe("buildFtsQuery", () => {
  test("tokenizes and quotes words", () => {
    expect(buildFtsQuery("hello world")).toBe('"hello" AND "world"');
  });

  test("removes punctuation and short tokens", () => {
    expect(buildFtsQuery("a hello! world?")).toBe('"hello" AND "world"');
  });

  test("lowercases tokens", () => {
    expect(buildFtsQuery("Hello WORLD")).toBe('"hello" AND "world"');
  });

  test("returns empty string for empty input", () => {
    expect(buildFtsQuery("")).toBe("");
  });

  test("returns empty string for only short tokens", () => {
    expect(buildFtsQuery("a b c")).toBe("");
  });
});

describe("bm25RankToScore", () => {
  test("converts rank 0 to score 1", () => {
    expect(bm25RankToScore(0)).toBe(1);
  });

  test("converts positive rank to score < 1", () => {
    expect(bm25RankToScore(1)).toBe(0.5);
  });

  test("handles negative rank (treats as 0)", () => {
    expect(bm25RankToScore(-5)).toBe(1);
  });
});

describe("mergeHybridResults", () => {
  function makeHit(id: number, score: number): SearchHit {
    return {
      chunkId: id,
      filePath: `file${id}.md`,
      startLine: 1,
      endLine: 10,
      text: `chunk ${id}`,
      score,
    };
  }

  test("merges vector and keyword results", () => {
    const vectorHits = [makeHit(1, 0.9), makeHit(2, 0.7)];
    const keywordHits = [makeHit(2, 0.8), makeHit(3, 0.6)];

    const merged = mergeHybridResults(vectorHits, keywordHits);

    // Chunk 2 should score highest (appears in both)
    expect(merged[0].chunkId).toBe(2);
    expect(merged.length).toBeLessThanOrEqual(6);
  });

  test("respects maxResults", () => {
    const vectorHits = [makeHit(1, 0.9), makeHit(2, 0.8), makeHit(3, 0.7)];
    const keywordHits = [makeHit(4, 0.9), makeHit(5, 0.8)];

    const merged = mergeHybridResults(vectorHits, keywordHits, { maxResults: 2 });

    expect(merged.length).toBeLessThanOrEqual(2);
  });

  test("filters by minScore", () => {
    const vectorHits = [makeHit(1, 0.9), makeHit(2, 0.1)];
    const keywordHits: SearchHit[] = [];

    // With only vector hits, vector weight is 1.0. Hit 1 normalizes to 1.0, hit 2 to 0.11
    const merged = mergeHybridResults(vectorHits, keywordHits, { minScore: 0.5 });

    expect(merged.length).toBe(1);
    expect(merged[0].chunkId).toBe(1);
  });

  test("handles empty inputs", () => {
    expect(mergeHybridResults([], [])).toEqual([]);
  });

  test("handles vector-only results", () => {
    const vectorHits = [makeHit(1, 0.9)];
    const merged = mergeHybridResults(vectorHits, []);

    expect(merged.length).toBe(1);
  });

  test("handles keyword-only results", () => {
    const keywordHits = [makeHit(1, 0.9)];
    const merged = mergeHybridResults([], keywordHits, { minScore: 0.2 });

    expect(merged.length).toBe(1);
  });
});
