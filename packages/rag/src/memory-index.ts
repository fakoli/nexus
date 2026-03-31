/**
 * MemoryIndex — vector-augmented memory search.
 *
 * Wraps the existing SQLite-based memory functions from @nexus/core with
 * LanceDB vector search. Falls back gracefully to LIKE search when no
 * embedding provider is available.
 */
import { addMemory, getMemory, updateMemory, deleteMemory, searchMemory } from "@nexus/core";
import type { MemoryNote } from "@nexus/core";
import { createLogger } from "@nexus/core";
import type { EmbeddingProvider } from "./embeddings.js";
import type { VectorStore } from "./vector-store.js";

const log = createLogger("rag:memory-index");

const MEMORY_TABLE = "memory_vectors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MemorySearchResult {
  note: MemoryNote;
  score?: number; // similarity score, only present for vector search
}

export interface MemoryIndexOptions {
  embeddingProvider?: EmbeddingProvider;
  vectorStore?: VectorStore;
}

// ── MemoryIndex ───────────────────────────────────────────────────────────────

export class MemoryIndex {
  private constructor(
    private readonly embeddingProvider: EmbeddingProvider | undefined,
    private readonly vectorStore: VectorStore | undefined,
  ) {}

  static async create(options?: MemoryIndexOptions): Promise<MemoryIndex> {
    const { embeddingProvider, vectorStore } = options ?? {};
    log.info(
      { hasProvider: Boolean(embeddingProvider), hasStore: Boolean(vectorStore) },
      "MemoryIndex created",
    );
    return new MemoryIndex(embeddingProvider, vectorStore);
  }

  /**
   * Store a memory note in SQLite (via core) and also embed + upsert into LanceDB.
   */
  async addMemory(content: string, scope?: string, tags?: string[]): Promise<MemoryNote> {
    const note = addMemory(content, scope, tags);

    if (this.embeddingProvider && this.vectorStore) {
      try {
        const [embedding] = await this.embeddingProvider.embed([content]);
        const table = await this.vectorStore.getOrCreateTable(MEMORY_TABLE, this.embeddingProvider?.dimensions);
        await table.upsert([
          {
            id: note.id,
            vector: embedding,
            content,
            metadata: {
              scope: note.scope,
              tags: JSON.stringify(note.tags),
              created_at: note.createdAt,
            },
          },
        ]);
        log.info({ id: note.id }, "Memory note embedded and indexed");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ id: note.id, err: msg }, "Failed to embed memory note; SQLite note still saved");
      }
    }

    return note;
  }

  /**
   * Search memory notes. Uses vector similarity when a query + embedding provider
   * are available; otherwise delegates to the existing LIKE-based SQLite search.
   */
  async searchMemory(options: {
    scope?: string;
    tags?: string[];
    query?: string;
    limit?: number;
  }): Promise<MemorySearchResult[]> {
    const { scope, tags, query, limit = 50 } = options;

    if (query && this.embeddingProvider && this.vectorStore) {
      return this._vectorSearch(query, { scope, tags, limit });
    }

    // Fallback: delegate to existing SQLite search
    const notes = searchMemory({ scope, tags, query, limit });
    return notes.map((note) => ({ note }));
  }

  getMemory(id: string): MemoryNote | null {
    return getMemory(id);
  }

  async updateMemory(
    id: string,
    updates: { content?: string; tags?: string[] },
  ): Promise<MemoryNote | null> {
    const note = updateMemory(id, updates);
    if (!note) return null;

    // Re-embed if content changed
    if (updates.content && this.embeddingProvider && this.vectorStore) {
      try {
        const [embedding] = await this.embeddingProvider.embed([updates.content]);
        const table = await this.vectorStore.getOrCreateTable(MEMORY_TABLE, this.embeddingProvider?.dimensions);
        await table.upsert([
          {
            id: note.id,
            vector: embedding,
            content: note.content,
            metadata: {
              scope: note.scope,
              tags: JSON.stringify(note.tags),
              created_at: note.createdAt,
            },
          },
        ]);
        log.info({ id }, "Memory note re-embedded after update");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ id, err: msg }, "Failed to re-embed memory note after update");
      }
    }

    return note;
  }

  async deleteMemory(id: string): Promise<boolean> {
    if (!UUID_RE.test(id)) {
      log.warn({ id }, "Invalid memory id format, refusing delete");
      return false;
    }
    const deleted = deleteMemory(id);
    if (deleted && this.vectorStore) {
      try {
        const table = await this.vectorStore.getOrCreateTable(MEMORY_TABLE, this.embeddingProvider?.dimensions);
        await table.delete(`id = '${id}'`);
        log.info({ id }, "Memory vector deleted");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ id, err: msg }, "Failed to delete memory vector");
      }
    }
    return deleted;
  }

  async close(): Promise<void> {
    if (this.vectorStore) {
      await this.vectorStore.close();
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _vectorSearch(
    query: string,
    options: { scope?: string; tags?: string[]; limit: number },
  ): Promise<MemorySearchResult[]> {
    const { scope, limit } = options;

    let embedding: number[];
    try {
      [embedding] = await this.embeddingProvider!.embed([query]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, "Embedding failed; falling back to SQLite search");
      const notes = searchMemory({ scope, query, limit });
      return notes.map((note) => ({ note }));
    }

    try {
      const table = await this.vectorStore!.getOrCreateTable(MEMORY_TABLE, this.embeddingProvider?.dimensions);
      // Use cosine distance so score formula (1 - distance) gives similarity in [0, 1]
      const searchOptions = { limit, distanceType: "cosine" as const };
      const results = await table.search(embedding, searchOptions);

      const searchResults: MemorySearchResult[] = [];
      for (const result of results) {
        // Optionally filter by scope using metadata
        if (scope !== undefined) {
          const metaScope = typeof result.metadata["scope"] === "string"
            ? result.metadata["scope"]
            : undefined;
          if (metaScope !== scope) continue;
        }

        const note = getMemory(result.id);
        if (note) {
          // Convert distance to similarity score (1 - normalized distance)
          const score = Math.max(0, 1 - result.distance);
          searchResults.push({ note, score });
        }
      }

      log.info({ query: query.slice(0, 50), resultCount: searchResults.length }, "Vector search complete");
      return searchResults;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, "Vector search failed; falling back to SQLite search");
      const notes = searchMemory({ scope, query, limit });
      return notes.map((note) => ({ note }));
    }
  }
}
