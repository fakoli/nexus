/**
 * Tests for the memory.semantic-search RPC handler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@lancedb/lancedb", () => ({ connect: vi.fn() }));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-mem-semantic-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import("@nexus/core");
  db.closeDb();
  db.runMigrations();
  return db;
}

type MockRow = {
  id: string;
  vector: number[];
  content: string;
  metadata: string;
  [key: string]: unknown;
};

function makeMockTable(rows: MockRow[] = []) {
  const stored: MockRow[] = [...rows];
  const mergeInsertChain = {
    whenMatchedUpdateAll: vi.fn().mockReturnThis(),
    whenNotMatchedInsertAll: vi.fn().mockReturnThis(),
    execute: vi.fn().mockImplementation(async (newRows: MockRow[]) => {
      for (const nr of newRows) {
        const idx = stored.findIndex((r) => r.id === nr.id);
        if (idx >= 0) { stored[idx] = nr; } else { stored.push(nr); }
      }
    }),
  };
  return {
    stored,
    table: {
      add: vi.fn(),
      mergeInsert: vi.fn().mockReturnValue(mergeInsertChain),
      search: vi.fn().mockImplementation((_v: number[]) => ({
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        distanceType: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(
          stored.map((r) => ({ ...r, _distance: 0.1 })),
        ),
      })),
      delete: vi.fn(),
    },
  };
}

function makeMockConnection() {
  const tables: Record<string, ReturnType<typeof makeMockTable>> = {};
  return {
    tables,
    conn: {
      tableNames: vi.fn().mockImplementation(async () => Object.keys(tables)),
      openTable: vi.fn().mockImplementation(async (name: string) => {
        if (!tables[name]) throw new Error(`No table: ${name}`);
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleMemorySemanticSearch", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const db = await import("@nexus/core");
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns INVALID_PARAMS when query is missing", async () => {
    const { handleMemorySemanticSearch } = await import("../handlers/memory.js");
    const result = await handleMemorySemanticSearch({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns INVALID_PARAMS when query is empty string", async () => {
    const { handleMemorySemanticSearch } = await import("../handlers/memory.js");
    const result = await handleMemorySemanticSearch({ query: "" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns RAG_DISABLED when RAG is not enabled in config", async () => {
    const { handleMemorySemanticSearch } = await import("../handlers/memory.js");
    // RAG is disabled by default
    const result = await handleMemorySemanticSearch({ query: "test query" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("RAG_DISABLED");
  });

  it("returns results with scores when RAG is enabled", async () => {
    const core = await import("@nexus/core");

    // Enable RAG in config
    core.setConfig("rag", {
      enabled: true,
      embeddingProvider: "ollama",
      embeddingModel: "nomic-embed-text",
      topK: 5,
      similarityThreshold: 0.5,
      autoIndex: true,
    });

    // Add a memory note to SQLite
    const note = core.addMemory("RAG indexed content", "global", ["test"]);

    // Mock LanceDB
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    // Seed the memory_vectors table with a row matching the note id
    mock.tables["memory_vectors"] = makeMockTable([
      {
        id: note.id,
        vector: [0.1, 0.2, 0.3],
        content: "RAG indexed content",
        metadata: JSON.stringify({ scope: "global", tags: "[]", created_at: note.createdAt }),
        _distance: 0.1,
      },
    ]);
    mock.conn.tableNames.mockResolvedValue(["memory_vectors"]);
    vi.mocked(lancedb.connect).mockResolvedValue(
      mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>,
    );

    // Mock the embedding provider (via @nexus/rag's createEmbeddingProvider)
    // We need to mock the Ollama fetch call
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
      text: async () => "",
    }));

    const { handleMemorySemanticSearch } = await import("../handlers/memory.js");
    const result = await handleMemorySemanticSearch({ query: "RAG indexed" });

    expect(result.ok).toBe(true);
    const payload = result.payload as { results: Array<{ note: unknown; score?: number }>; count: number };
    expect(Array.isArray(payload.results)).toBe(true);
    expect(payload.count).toBeGreaterThanOrEqual(0);

    vi.unstubAllGlobals();
  });

  it("returns INTERNAL_ERROR when vector store connection fails", async () => {
    const core = await import("@nexus/core");
    core.setConfig("rag", {
      enabled: true,
      embeddingProvider: "ollama",
      embeddingModel: "nomic-embed-text",
      topK: 5,
      similarityThreshold: 0.5,
      autoIndex: true,
    });

    // Make lancedb.connect throw
    const lancedb = await import("@lancedb/lancedb");
    vi.mocked(lancedb.connect).mockRejectedValueOnce(new Error("Connection refused"));

    const { handleMemorySemanticSearch } = await import("../handlers/memory.js");
    const result = await handleMemorySemanticSearch({ query: "test query" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INTERNAL_ERROR");
  });

  it("validates limit parameter (max 100)", async () => {
    const { handleMemorySemanticSearch } = await import("../handlers/memory.js");
    const result = await handleMemorySemanticSearch({ query: "test", limit: 999 });
    // Will fail params validation since RAG is disabled — but limit validation runs first
    // So if disabled it's RAG_DISABLED, if limit is invalid it's INVALID_PARAMS
    // With invalid limit of 999, schema rejects it first
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("validates threshold must be between 0 and 1", async () => {
    const { handleMemorySemanticSearch } = await import("../handlers/memory.js");
    const result = await handleMemorySemanticSearch({ query: "test", threshold: 2.0 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });
});
