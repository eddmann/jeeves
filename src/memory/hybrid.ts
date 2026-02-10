/**
 * Hybrid search — vector similarity + BM25/FTS5 keyword search.
 */

export interface SearchHit {
  chunkId: number;
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

export interface HybridMergeOpts {
  maxResults?: number;
  minScore?: number;
  vectorWeight?: number;
  textWeight?: number;
}

const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_MIN_SCORE = 0.35;
const DEFAULT_VECTOR_WEIGHT = 0.7;
const DEFAULT_TEXT_WEIGHT = 0.3;

/** Cosine similarity between two vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Build an FTS5 query from natural language. Tokenize, quote, AND-join. */
export function buildFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  if (tokens.length === 0) return "";

  return tokens.map((t) => `"${t}"`).join(" AND ");
}

/** Convert BM25 rank (negative by convention in FTS5) to a 0-1 score. */
export function bm25RankToScore(rank: number): number {
  return 1 / (1 + Math.max(0, rank));
}

/** Merge vector and keyword search results using weighted combination. */
export function mergeHybridResults(
  vectorHits: SearchHit[],
  keywordHits: SearchHit[],
  opts?: HybridMergeOpts,
): SearchHit[] {
  const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;
  const minScore = opts?.minScore ?? DEFAULT_MIN_SCORE;
  const configuredVectorWeight = opts?.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;
  const configuredTextWeight = opts?.textWeight ?? DEFAULT_TEXT_WEIGHT;

  // When one side is empty, give the other full weight
  const hasVector = vectorHits.length > 0;
  const hasKeyword = keywordHits.length > 0;
  const vectorWeight = hasVector ? (hasKeyword ? configuredVectorWeight : 1.0) : 0;
  const textWeight = hasKeyword ? (hasVector ? configuredTextWeight : 1.0) : 0;

  // Normalize vector scores to 0-1 range
  const maxVectorScore = Math.max(...vectorHits.map((h) => h.score), 0.001);
  const normalizedVector = vectorHits.map((h) => ({
    ...h,
    score: h.score / maxVectorScore,
  }));

  // Normalize keyword scores to 0-1 range
  const maxKeywordScore = Math.max(...keywordHits.map((h) => h.score), 0.001);
  const normalizedKeyword = keywordHits.map((h) => ({
    ...h,
    score: h.score / maxKeywordScore,
  }));

  // Union by chunk ID
  const merged = new Map<number, SearchHit>();

  for (const hit of normalizedVector) {
    merged.set(hit.chunkId, {
      ...hit,
      score: hit.score * vectorWeight,
    });
  }

  for (const hit of normalizedKeyword) {
    const existing = merged.get(hit.chunkId);
    if (existing) {
      existing.score += hit.score * textWeight;
    } else {
      merged.set(hit.chunkId, {
        ...hit,
        score: hit.score * textWeight,
      });
    }
  }

  return Array.from(merged.values())
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
