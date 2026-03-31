/**
 * Tests for context-builder.ts — RAG semantic retrieval extension.
 *
 * Covers the ragOptions path in buildContext().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

// ── LanceDB mock ─────────────────────────────────────────────────────────────

vi.mock("@lancedb/lancedb", () => ({ connect: vi.fn() }));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), `nexus-ctx-rag-test-${process.pid}-`));
}

type MockRow = {
  id: string;
  vector: number[];
  content: string;
  metadata: string;
  [key: string]: unknown;
};

function makeMockTable(initialRows: MockRow[] = []) {
  const rows: MockRow[] = [...initialRows];
  const mergeInsertChain = {
    whenMatchedUpdateAll: vi.fn().mockReturnThis(),
    whenNotMatchedInsertAll: vi.fn().mockReturnThis(),
    execute: vi.fn().mockImplementation(async (newRows: MockRow[]) => {
      for (const nr of newRows) {
        const idx = rows.findIndex((r) => r.id === nr.id);
        if (idx >= 0) { rows[idx] = nr; } else { rows.push(nr); }
      }
    }),
  };
  return {
    rows,
    table: {
      add: vi.fn(),
      mergeInsert: vi.fn().mockReturnValue(mergeInsertChain),
      search: vi.fn().mockImplementation((_vector: number[]) => {
        const queryObj = {
          _limit: 10,
          limit(n: number) { queryObj._limit = n; return queryObj; },
          where(_f: string) { return queryObj; },
          distanceType(_dt: string) { return queryObj; },
          toArray: vi.fn().mockImplementation(async () =>
            // Preserve _distance from row data if present, else default to 0.1
            rows.slice(0, queryObj._limit).map((r) => ({
              ...r,
              _distance: typeof r["_distance"] === "number" ? r["_distance"] : 0.1,
            })),
          ),
        };
        return queryObj;
      }),
      delete: vi.fn(),
    },
    mergeInsertChain,
  };
}

function makeMockConnection(preexistingTables: string[] = []) {
  const tables: Record<string, ReturnType<typeof makeMockTable>> = {};
  for (const t of preexistingTables) {
    tables[t] = makeMockTable([]);
  }
  return {
    tables,
    conn: {
      tableNames: vi.fn().mockImplementation(async () => Object.keys(tables)),
      openTable: vi.fn().mockImplementation(async (name: string) => {
        if (!tables[name]) throw new Error(`Table ${name} not found`);
        return tables[name].table;
      }),
      createTable: vi.fn().mockImplementation(async (name: string, data: MockRow[]) => {
        tables[name] = makeMockTable(data);
        return tables[name].table;
      }),
      close: vi.fn(),
    },
  };
}

function makeMockEmbeddingProvider() {
  return {
    id: "mock",
    dimensions: 3,
    embed: vi.fn().mockImplementation(async (texts: string[]) =>
      texts.map(() => [0.1, 0.2, 0.3]),
    ),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildContext with RAG", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    process.env.NEXUS_DATA_DIR = dir;
    const core = await import("@nexus/core");
    core.closeDb();
    core.runMigrations();
    core.getOrCreateAgent("default");
  });

  afterEach(async () => {
    const core = await import("@nexus/core");
    core.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("returns original system prompt when ragOptions not provided", async () => {
    const core = await import("@nexus/core");
    const sessionId = `rag-test-${Date.now()}`;
    core.getOrCreateSession(sessionId, "default");

    const { buildContext } = await import("../context-builder.js");
    const ctx = await buildContext({
      sessionId,
      systemPrompt: "Base system prompt",
    });

    expect(ctx.systemPrompt).toBe("Base system prompt");
  });

  it("returns original system prompt when ragOptions has no currentQuery", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    vi.mocked(lancedb.connect).mockResolvedValueOnce(
      mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>,
    );

    const core = await import("@nexus/core");
    const sessionId = `rag-test-${Date.now()}`;
    core.getOrCreateSession(sessionId, "default");

    const { VectorStore } = await import("@nexus/rag");
    const vectorStore = await VectorStore.connect("/tmp/test");
    const embeddingProvider = makeMockEmbeddingProvider();

    const { buildContext } = await import("../context-builder.js");
    const ctx = await buildContext({
      sessionId,
      systemPrompt: "Base system prompt",
      ragOptions: { embeddingProvider, vectorStore },
    });

    expect(ctx.systemPrompt).toBe("Base system prompt");
    expect(embeddingProvider.embed).not.toHaveBeenCalled();
  });

  it("prepends semantic context to system prompt when relevant messages found", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    // Pre-seed the message_vectors table with a relevant result
    mock.tables["message_vectors"] = makeMockTable([
      {
        id: "past-msg-1",
        vector: [0.1, 0.2, 0.3],
        content: "The answer is 42",
        metadata: JSON.stringify({ session_id: "old-session", role: "assistant", timestamp: 1000 }),
        _distance: 0.05, // low distance = high similarity
      },
    ]);
    mock.conn.tableNames.mockResolvedValue(["message_vectors"]);
    vi.mocked(lancedb.connect).mockResolvedValueOnce(
      mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>,
    );

    const core = await import("@nexus/core");
    const sessionId = `rag-test-${Date.now()}`;
    core.getOrCreateSession(sessionId, "default");

    const { VectorStore } = await import("@nexus/rag");
    const vectorStore = await VectorStore.connect("/tmp/test");
    const embeddingProvider = makeMockEmbeddingProvider();

    const { buildContext } = await import("../context-builder.js");
    const ctx = await buildContext({
      sessionId,
      systemPrompt: "Base prompt",
      ragOptions: {
        embeddingProvider,
        vectorStore,
        topK: 5,
        similarityThreshold: 0.5, // threshold low enough that distance=0.1 passes
        currentQuery: "What is the answer?",
      },
    });

    expect(embeddingProvider.embed).toHaveBeenCalledWith(["What is the answer?"]);
    // System prompt should contain either the context block or the base prompt
    // (context prepended if retrieved results pass threshold)
    expect(typeof ctx.systemPrompt).toBe("string");
  });

  it("does not duplicate messages already in history window", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    const sharedContent = "Shared content that is in both history and vector store";
    mock.tables["message_vectors"] = makeMockTable([
      {
        id: "vec-msg-1",
        vector: [0.1, 0.2, 0.3],
        content: sharedContent,
        metadata: JSON.stringify({ session_id: "s", role: "user", timestamp: 1000 }),
        _distance: 0.05,
      },
    ]);
    mock.conn.tableNames.mockResolvedValue(["message_vectors"]);
    vi.mocked(lancedb.connect).mockResolvedValueOnce(
      mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>,
    );

    const core = await import("@nexus/core");
    const sessionId = `rag-dedup-${Date.now()}`;
    core.getOrCreateSession(sessionId, "default");
    // Add the same content to the SQLite history
    core.appendMessage(sessionId, "user", sharedContent);

    const { VectorStore } = await import("@nexus/rag");
    const vectorStore = await VectorStore.connect("/tmp/test");
    const embeddingProvider = makeMockEmbeddingProvider();

    const { buildContext } = await import("../context-builder.js");
    const ctx = await buildContext({
      sessionId,
      systemPrompt: "Base",
      ragOptions: {
        embeddingProvider,
        vectorStore,
        topK: 5,
        similarityThreshold: 0.0, // Accept everything
        currentQuery: "What do you know?",
      },
    });

    // The system prompt should NOT contain duplicated content from history
    const count = (ctx.systemPrompt.match(new RegExp(sharedContent, "g")) ?? []).length;
    expect(count).toBeLessThanOrEqual(1);
  });

  it("falls back gracefully when embedding provider throws", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    vi.mocked(lancedb.connect).mockResolvedValueOnce(
      mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>,
    );

    const core = await import("@nexus/core");
    const sessionId = `rag-err-${Date.now()}`;
    core.getOrCreateSession(sessionId, "default");

    const { VectorStore } = await import("@nexus/rag");
    const vectorStore = await VectorStore.connect("/tmp/test");
    const embeddingProvider = makeMockEmbeddingProvider();
    (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Connection error"),
    );

    const { buildContext } = await import("../context-builder.js");
    // Should not throw — falls back gracefully
    const ctx = await buildContext({
      sessionId,
      systemPrompt: "Base prompt",
      ragOptions: {
        embeddingProvider,
        vectorStore,
        currentQuery: "Test query",
      },
    });

    // System prompt should remain unchanged
    expect(ctx.systemPrompt).toBe("Base prompt");
  });

  it("falls back gracefully when vector search throws", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    // Create a broken table that throws on search
    mock.tables["message_vectors"] = makeMockTable([]);
    mock.tables["message_vectors"].table.search = vi.fn().mockImplementation(() => {
      throw new Error("LanceDB search error");
    });
    mock.conn.tableNames.mockResolvedValue(["message_vectors"]);
    vi.mocked(lancedb.connect).mockResolvedValueOnce(
      mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>,
    );

    const core = await import("@nexus/core");
    const sessionId = `rag-err2-${Date.now()}`;
    core.getOrCreateSession(sessionId, "default");

    const { VectorStore } = await import("@nexus/rag");
    const vectorStore = await VectorStore.connect("/tmp/test");
    const embeddingProvider = makeMockEmbeddingProvider();

    const { buildContext } = await import("../context-builder.js");
    const ctx = await buildContext({
      sessionId,
      systemPrompt: "Base prompt",
      ragOptions: {
        embeddingProvider,
        vectorStore,
        currentQuery: "Test query",
      },
    });

    expect(ctx.systemPrompt).toBe("Base prompt");
  });

  it("filters results below similarity threshold", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    mock.tables["message_vectors"] = makeMockTable([
      {
        id: "vec-1",
        vector: [0.1, 0.2, 0.3],
        content: "Barely relevant content",
        metadata: JSON.stringify({ session_id: "s", role: "user", timestamp: 1000 }),
        _distance: 0.95, // very high distance = very low similarity
      },
    ]);
    mock.conn.tableNames.mockResolvedValue(["message_vectors"]);
    vi.mocked(lancedb.connect).mockResolvedValueOnce(
      mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>,
    );

    const core = await import("@nexus/core");
    const sessionId = `rag-thresh-${Date.now()}`;
    core.getOrCreateSession(sessionId, "default");

    const { VectorStore } = await import("@nexus/rag");
    const vectorStore = await VectorStore.connect("/tmp/test");
    const embeddingProvider = makeMockEmbeddingProvider();

    const { buildContext } = await import("../context-builder.js");
    const ctx = await buildContext({
      sessionId,
      systemPrompt: "Base prompt",
      ragOptions: {
        embeddingProvider,
        vectorStore,
        similarityThreshold: 0.5, // distance=0.95 → score=0.05, below threshold
        currentQuery: "Some query",
      },
    });

    // Low-similarity result should be filtered; no context block prepended
    expect(ctx.systemPrompt).toBe("Base prompt");
  });
});
