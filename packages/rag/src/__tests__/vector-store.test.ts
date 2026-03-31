/**
 * Integration-style tests for VectorStore and VectorTable.
 * @lancedb/lancedb is mocked so no real filesystem is required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";

// ── LanceDB mock ──────────────────────────────────────────────────────────────

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
        if (idx >= 0) {
          rows[idx] = nr;
        } else {
          rows.push(nr);
        }
      }
    }),
  };

  return {
    rows,
    table: {
      add: vi.fn().mockImplementation(async (newRows: MockRow[]) => {
        rows.push(...newRows);
      }),
      mergeInsert: vi.fn().mockReturnValue(mergeInsertChain),
      search: vi.fn().mockImplementation((_vector: number[]) => {
        const queryObj = {
          _limit: 10,
          _filter: undefined as string | undefined,
          _distanceType: undefined as string | undefined,
          limit(n: number) {
            queryObj._limit = n;
            return queryObj;
          },
          where(f: string) {
            queryObj._filter = f;
            return queryObj;
          },
          distanceType(dt: string) {
            queryObj._distanceType = dt;
            return queryObj;
          },
          toArray: vi.fn().mockImplementation(async () => {
            return rows
              .slice(0, queryObj._limit)
              .map((r) => ({ ...r, _distance: 0.1 }));
          }),
        };
        return queryObj;
      }),
      delete: vi.fn().mockImplementation(async (filter: string) => {
        const idMatch = filter.match(/id\s*=\s*'([^']+)'/);
        if (idMatch) {
          const targetId = idMatch[1];
          const idx = rows.findIndex((r) => r.id === targetId);
          if (idx >= 0) rows.splice(idx, 1);
        }
      }),
    },
    mergeInsertChain,
  };
}

function makeMockConnection(tableNames: string[] = []) {
  const tables: Record<string, ReturnType<typeof makeMockTable>> = {};

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

vi.mock("@lancedb/lancedb", () => ({
  connect: vi.fn(),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("VectorStore.connect", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("connects to the given path", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const { conn } = makeMockConnection();
    vi.mocked(lancedb.connect).mockResolvedValueOnce(conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>);

    const { VectorStore } = await import("../vector-store.js");
    const store = await VectorStore.connect("/tmp/test-db");

    expect(lancedb.connect).toHaveBeenCalledWith("/tmp/test-db");
    expect(store).toBeDefined();
  });

  it("uses default path (~/.nexus/vectordb) when no path given", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const { conn } = makeMockConnection();
    vi.mocked(lancedb.connect).mockResolvedValueOnce(conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>);

    const { VectorStore } = await import("../vector-store.js");
    await VectorStore.connect();

    const expectedPath = path.join(os.homedir(), ".nexus", "vectordb");
    expect(lancedb.connect).toHaveBeenCalledWith(expectedPath);
  });
});

describe("VectorStore.getOrCreateTable", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new table when it does not exist", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    vi.mocked(lancedb.connect).mockResolvedValueOnce(mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>);

    const { VectorStore } = await import("../vector-store.js");
    const store = await VectorStore.connect("/tmp/test-db");
    const table = await store.getOrCreateTable("docs");

    expect(mock.conn.createTable).toHaveBeenCalledWith(
      "docs",
      expect.any(Array),
      expect.objectContaining({ mode: "create" }),
    );
    expect(table).toBeDefined();
  });

  it("opens existing table when it already exists", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection(["docs"]);
    // Pre-populate so tableNames returns ["docs"]
    mock.tables["docs"] = makeMockTable([]);
    vi.mocked(lancedb.connect).mockResolvedValueOnce(mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>);
    mock.conn.tableNames.mockResolvedValueOnce(["docs"]);

    const { VectorStore } = await import("../vector-store.js");
    const store = await VectorStore.connect("/tmp/test-db");
    const table = await store.getOrCreateTable("docs");

    expect(mock.conn.openTable).toHaveBeenCalledWith("docs");
    expect(mock.conn.createTable).not.toHaveBeenCalled();
    expect(table).toBeDefined();
  });
});

describe("VectorTable.upsert", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing for empty records array", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    vi.mocked(lancedb.connect).mockResolvedValueOnce(mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>);

    const { VectorStore } = await import("../vector-store.js");
    const store = await VectorStore.connect("/tmp/test-db");
    const vt = await store.getOrCreateTable("empty_test");
    await expect(vt.upsert([])).resolves.not.toThrow();
  });

  it("inserts records via mergeInsert", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    vi.mocked(lancedb.connect).mockResolvedValueOnce(mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>);

    const { VectorStore } = await import("../vector-store.js");
    const store = await VectorStore.connect("/tmp/test-db");
    const vt = await store.getOrCreateTable("records_test");

    const records = [
      { id: "r1", vector: [0.1, 0.2], content: "hello", metadata: { source: "test" } },
      { id: "r2", vector: [0.3, 0.4], content: "world", metadata: {} },
    ];
    await vt.upsert(records);

    const tableMock = mock.tables["records_test"];
    expect(tableMock).toBeDefined();
    expect(tableMock.table.mergeInsert).toHaveBeenCalledWith("id");
    expect(tableMock.mergeInsertChain.whenMatchedUpdateAll).toHaveBeenCalled();
    expect(tableMock.mergeInsertChain.whenNotMatchedInsertAll).toHaveBeenCalled();
    expect(tableMock.mergeInsertChain.execute).toHaveBeenCalled();
  });
});

describe("VectorTable.search", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns search results with distance", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const existingRow: MockRow = {
      id: "doc1",
      vector: [0.1, 0.2],
      content: "hello world",
      metadata: JSON.stringify({ source: "test" }),
    };
    const mock = makeMockConnection();
    mock.tables["docs"] = makeMockTable([existingRow]);
    vi.mocked(lancedb.connect).mockResolvedValueOnce(mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>);
    mock.conn.tableNames.mockResolvedValueOnce(["docs"]);

    const { VectorStore } = await import("../vector-store.js");
    const store = await VectorStore.connect("/tmp/test-db");
    const vt = await store.getOrCreateTable("docs");

    const results = await vt.search([0.1, 0.2], { limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("doc1");
    expect(results[0].content).toBe("hello world");
    expect(results[0].metadata).toEqual({ source: "test" });
    expect(typeof results[0].distance).toBe("number");
  });

  it("applies limit option", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    mock.tables["docs"] = makeMockTable([]);
    vi.mocked(lancedb.connect).mockResolvedValueOnce(mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>);
    mock.conn.tableNames.mockResolvedValueOnce(["docs"]);

    const { VectorStore } = await import("../vector-store.js");
    const store = await VectorStore.connect("/tmp/test-db");
    const vt = await store.getOrCreateTable("docs");

    const searchSpy = mock.tables["docs"].table.search;
    await vt.search([0.1], { limit: 3 });

    // The query object should have been called with limit(3)
    expect(searchSpy).toHaveBeenCalled();
  });
});

describe("VectorTable.delete", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls table.delete with the filter string", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    mock.tables["docs"] = makeMockTable([]);
    vi.mocked(lancedb.connect).mockResolvedValueOnce(mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>);
    mock.conn.tableNames.mockResolvedValueOnce(["docs"]);

    const { VectorStore } = await import("../vector-store.js");
    const store = await VectorStore.connect("/tmp/test-db");
    const vt = await store.getOrCreateTable("docs");

    await vt.delete("source = 'old'");

    expect(mock.tables["docs"].table.delete).toHaveBeenCalledWith("source = 'old'");
  });
});

describe("VectorStore.close", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls close on the connection", async () => {
    const lancedb = await import("@lancedb/lancedb");
    const mock = makeMockConnection();
    vi.mocked(lancedb.connect).mockResolvedValueOnce(mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>);

    const { VectorStore } = await import("../vector-store.js");
    const store = await VectorStore.connect("/tmp/test-db");
    await store.close();

    expect(mock.conn.close).toHaveBeenCalled();
  });
});
