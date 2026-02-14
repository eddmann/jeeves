/**
 * MemoryIndex — SQLite-backed semantic memory with vector + FTS5 hybrid search.
 * Uses bun:sqlite (Bun's built-in synchronous SQLite driver).
 */

import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import * as sqliteVec from "sqlite-vec";
import type { EmbedFn } from "./embeddings";
import type { SearchHit } from "./hybrid";
import { cosineSimilarity, buildFtsQuery, bm25RankToScore, mergeHybridResults } from "./hybrid";
import { log, formatError } from "../logger";
import type { LLMMessage } from "../llm";

let customSqliteSet = false;

/** Try to set Homebrew SQLite on macOS (required for extension loading). */
function ensureCustomSqlite(): void {
  if (customSqliteSet) return;
  customSqliteSet = true;
  if (process.platform !== "darwin") return;
  try {
    Database.setCustomSQLite("/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib");
  } catch {
    // Homebrew SQLite not available — extensions won't load
  }
}

const CHUNK_SIZE_CHARS = 1600; // ~400 tokens
const CHUNK_OVERLAP_CHARS = 320; // ~80 tokens
const COMPACTION_MARKER = '{"@@compaction":true}';

export interface MemorySearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

export class MemoryIndex {
  private db: Database;
  private workspaceDir: string;
  private hasVec: boolean;

  constructor(
    dbPath: string,
    private embedFn: EmbedFn,
    workspaceDir: string,
  ) {
    this.workspaceDir = workspaceDir;

    const dbDir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    if (dbDir) mkdirSync(dbDir, { recursive: true });

    ensureCustomSqlite();
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");

    this.hasVec = false;
    try {
      sqliteVec.load(this.db);
      this.hasVec = true;
    } catch {
      log.debug("memory-index", "sqlite-vec not available, using JS fallback for vector search");
    }

    this.initSchema();
  }

  /** Sync all indexable content: memory files + session files. */
  async sync(): Promise<void> {
    await this.syncMemories();
    await this.syncSessions();
  }

  /** Search memory using hybrid vector + keyword search. */
  async search(query: string, maxResults = 6): Promise<MemorySearchResult[]> {
    let vectorHits: SearchHit[] = [];
    try {
      const queryEmbedding = (await this.embedFn([query]))[0];
      if (queryEmbedding) {
        vectorHits = this.vectorSearch(queryEmbedding, maxResults * 4);
      }
    } catch (err) {
      log.warn("memory-index", "Vector search failed", formatError(err));
    }

    const keywordHits = this.keywordSearch(query, maxResults * 4);
    const merged = mergeHybridResults(vectorHits, keywordHits, { maxResults });

    return merged.map((h) => ({
      filePath: h.filePath,
      startLine: h.startLine,
      endLine: h.endLine,
      text: h.text,
      score: h.score,
    }));
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT,
        mtime_ms REAL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        hash TEXT NOT NULL,
        embedding TEXT,
        FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
    `);

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          text,
          content=chunks,
          content_rowid=id
        );
      `);
    } catch {
      // FTS table may already exist
    }

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
      END;
      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
        INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
    `);
  }

  private hasIncompleteEmbeddings(filePath: string): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) as c FROM chunks WHERE file_path = ? AND embedding IS NULL")
      .get(filePath) as { c: number };
    return row.c > 0;
  }

  private async syncMemories(): Promise<void> {
    const memoryDir = join(this.workspaceDir, "memory");
    const filesToIndex: Array<{ relativePath: string; absolutePath: string }> = [];

    const memoryMdPath = join(this.workspaceDir, "MEMORY.md");
    if (existsSync(memoryMdPath)) {
      filesToIndex.push({ relativePath: "MEMORY.md", absolutePath: memoryMdPath });
    }

    if (existsSync(memoryDir)) {
      for (const entry of readdirSync(memoryDir)) {
        if (entry.endsWith(".md")) {
          filesToIndex.push({
            relativePath: `memory/${entry}`,
            absolutePath: join(memoryDir, entry),
          });
        }
      }
    }

    const getFile = this.db.prepare("SELECT hash, mtime_ms FROM files WHERE path = ?");
    const allPaths = new Set<string>();

    for (const file of filesToIndex) {
      allPaths.add(file.relativePath);
      const content = readFileSync(file.absolutePath, "utf-8");
      const hash = createHash("sha256").update(content).digest("hex");

      const existing = getFile.get(file.relativePath) as
        | { hash: string; mtime_ms: number }
        | undefined;
      if (existing && existing.hash === hash && !this.hasIncompleteEmbeddings(file.relativePath)) {
        continue;
      }

      await this.indexFile(file.relativePath, content, hash);
    }

    const allDbPaths = this.db
      .prepare("SELECT path FROM files")
      .all()
      .map((r) => (r as { path: string }).path);

    for (const dbPath of allDbPaths) {
      if (!allPaths.has(dbPath) && !dbPath.startsWith("session:")) {
        this.removeFile(dbPath);
      }
    }
  }

  private async syncSessions(): Promise<void> {
    const sessionsDir = join(this.workspaceDir, "sessions");
    if (!existsSync(sessionsDir)) return;

    const entries = readdirSync(sessionsDir).filter((e) => e.endsWith(".jsonl"));
    if (entries.length === 0) return;

    const groups = new Map<string, Array<{ entry: string; seq: number }>>();

    for (const entry of entries) {
      const match = entry.match(/^(.+?)(?:\.(\d+))?\.jsonl$/);
      if (!match) continue;

      const key = match[1];
      const seq = match[2] ? Number(match[2]) : 0;

      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ entry, seq });
    }

    const activeSessionPaths = new Set<string>();

    for (const [, files] of groups) {
      const maxSeq = Math.max(...files.map((f) => f.seq));
      for (const file of files) {
        const isActive = file.seq === maxSeq;
        activeSessionPaths.add(`session:${file.entry}`);
        await this.indexSessionFile(join(sessionsDir, file.entry), isActive);
      }
    }

    const dbSessionPaths = this.db
      .prepare("SELECT path FROM files WHERE path LIKE 'session:%'")
      .all()
      .map((r) => (r as { path: string }).path);

    for (const dbPath of dbSessionPaths) {
      if (!activeSessionPaths.has(dbPath)) {
        this.removeFile(dbPath);
      }
    }
  }

  /**
   * Index a JSONL session file for searchability.
   * For the active session file, only indexes content before the last compaction
   * marker — everything after the marker is already in the LLM's context window.
   * For archived files, indexes the entire file.
   */
  private async indexSessionFile(sessionPath: string, isActive: boolean): Promise<void> {
    if (!existsSync(sessionPath)) return;

    const filename = sessionPath.split("/").pop() ?? sessionPath;
    const filePath = `session:${filename}`;

    const rawContent = readFileSync(sessionPath, "utf-8").trim();
    if (!rawContent) return;

    const allLines = rawContent.split("\n").filter((l) => l.trim());

    let linesToIndex: string[];
    if (isActive) {
      let lastMarkerIndex = -1;
      for (let i = allLines.length - 1; i >= 0; i--) {
        if (allLines[i] === COMPACTION_MARKER) {
          lastMarkerIndex = i;
          break;
        }
      }

      if (lastMarkerIndex <= 0) {
        return;
      }

      linesToIndex = allLines.slice(0, lastMarkerIndex);
    } else {
      linesToIndex = allLines;
    }

    const indexableContent = linesToIndex.join("\n");
    const hash = createHash("sha256").update(indexableContent).digest("hex");

    const existing = this.db.prepare("SELECT hash FROM files WHERE path = ?").get(filePath) as
      | { hash: string }
      | undefined;
    if (existing && existing.hash === hash && !this.hasIncompleteEmbeddings(filePath)) return;

    const textParts: string[] = [];

    for (const line of linesToIndex) {
      if (line === COMPACTION_MARKER) continue;
      try {
        const msg = JSON.parse(line) as LLMMessage;
        if (typeof msg.content === "string") {
          textParts.push(`${msg.role}: ${msg.content}`);
        } else {
          const texts = msg.content
            .filter((b) => b.type === "text")
            .map((b) => (b as { text: string }).text);
          if (texts.length > 0) {
            textParts.push(`${msg.role}: ${texts.join("\n")}`);
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    const sessionText = textParts.join("\n\n");
    if (!sessionText) {
      this.removeFile(filePath);
      return;
    }

    await this.indexFile(filePath, sessionText, hash);
  }

  private async indexFile(filePath: string, content: string, hash: string): Promise<void> {
    this.removeFile(filePath);
    const chunks = chunkText(content);

    if (chunks.length === 0) return;

    let embeddings: number[][] = [];
    try {
      embeddings = await this.embedFn(chunks.map((c) => c.text));
    } catch (err) {
      log.warn("memory-index", "Embedding failed, storing without vectors", {
        file: filePath,
        ...formatError(err),
      });
    }

    this.db
      .prepare("INSERT OR REPLACE INTO files (path, hash, mtime_ms) VALUES (?, ?, ?)")
      .run(filePath, hash, Date.now());

    const insertChunk = this.db.prepare(
      "INSERT INTO chunks (file_path, start_line, end_line, text, hash, embedding) VALUES (?, ?, ?, ?, ?, ?)",
    );

    const insertMany = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkHash = createHash("sha256").update(chunk.text).digest("hex");
        const embedding = embeddings[i] ? JSON.stringify(embeddings[i]) : null;
        insertChunk.run(filePath, chunk.startLine, chunk.endLine, chunk.text, chunkHash, embedding);
      }
    });

    insertMany();

    log.debug("memory-index", "Indexed file", { file: filePath, chunks: chunks.length });
  }

  private removeFile(filePath: string): void {
    this.db.prepare("DELETE FROM chunks WHERE file_path = ?").run(filePath);
    this.db.prepare("DELETE FROM files WHERE path = ?").run(filePath);
  }

  private vectorSearch(queryEmbedding: number[], limit: number): SearchHit[] {
    if (this.hasVec) {
      return this.vectorSearchNative(queryEmbedding, limit);
    }
    return this.vectorSearchJS(queryEmbedding, limit);
  }

  private vectorSearchNative(queryEmbedding: number[], limit: number): SearchHit[] {
    const queryJson = JSON.stringify(queryEmbedding);
    const rows = this.db
      .prepare(
        `SELECT id, file_path, start_line, end_line, text,
                vec_distance_cosine(embedding, ?) AS distance
         FROM chunks
         WHERE embedding IS NOT NULL
         ORDER BY distance
         LIMIT ?`,
      )
      .all(queryJson, limit) as Array<{
      id: number;
      file_path: string;
      start_line: number;
      end_line: number;
      text: string;
      distance: number;
    }>;

    return rows.map((row) => ({
      chunkId: row.id,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      text: row.text,
      score: 1 - row.distance,
    }));
  }

  private vectorSearchJS(queryEmbedding: number[], limit: number): SearchHit[] {
    const rows = this.db
      .prepare(
        "SELECT id, file_path, start_line, end_line, text, embedding FROM chunks WHERE embedding IS NOT NULL",
      )
      .all() as Array<{
      id: number;
      file_path: string;
      start_line: number;
      end_line: number;
      text: string;
      embedding: string;
    }>;

    const scored = rows
      .map((row) => {
        const embedding = JSON.parse(row.embedding) as number[];
        const score = cosineSimilarity(queryEmbedding, embedding);
        return {
          chunkId: row.id,
          filePath: row.file_path,
          startLine: row.start_line,
          endLine: row.end_line,
          text: row.text,
          score,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  private keywordSearch(query: string, limit: number): SearchHit[] {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];

    try {
      const rows = this.db
        .prepare(
          `SELECT c.id, c.file_path, c.start_line, c.end_line, c.text, rank
           FROM chunks_fts f
           JOIN chunks c ON c.id = f.rowid
           WHERE chunks_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(ftsQuery, limit) as Array<{
        id: number;
        file_path: string;
        start_line: number;
        end_line: number;
        text: string;
        rank: number;
      }>;

      return rows.map((row) => ({
        chunkId: row.id,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        text: row.text,
        score: bm25RankToScore(-row.rank),
      }));
    } catch {
      return [];
    }
  }
}

/** Chunk text into overlapping segments by line. */
export function chunkText(
  content: string,
  chunkSize = CHUNK_SIZE_CHARS,
  overlap = CHUNK_OVERLAP_CHARS,
): Array<{ text: string; startLine: number; endLine: number }> {
  const lines = content.split("\n");
  const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];

  let currentChars = 0;
  let chunkStart = 0;

  for (let i = 0; i < lines.length; i++) {
    currentChars += lines[i].length + 1; // +1 for newline

    if (currentChars >= chunkSize || i === lines.length - 1) {
      const text = lines.slice(chunkStart, i + 1).join("\n");
      if (text.trim()) {
        chunks.push({
          text,
          startLine: chunkStart + 1, // 1-indexed
          endLine: i + 1,
        });
      }

      if (i < lines.length - 1) {
        let overlapChars = 0;
        let overlapStart = i;
        while (overlapStart > chunkStart && overlapChars < overlap) {
          overlapChars += lines[overlapStart].length + 1;
          overlapStart--;
        }
        chunkStart = overlapStart + 1;
        currentChars = lines.slice(chunkStart, i + 1).reduce((s, l) => s + l.length + 1, 0);
      }
    }
  }

  return chunks;
}
