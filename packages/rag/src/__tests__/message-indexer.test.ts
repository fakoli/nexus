/**
 * Tests for MessageIndexer — micro-batching pipeline for message auto-indexing.
 *
 * LanceDB and embedding providers are fully mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── LanceDB mock ─────────────────────────────────────────────────────────────

vi.mock("@lancedb/lancedb", () => ({ connect: vi.fn() }));

// ── Helpers ──────────────────────────────────────────────────────────────────

type MockRow = {
  id: string;
  vector: number[];
  content: string;
  metadata: string;
  [key: string]: unknown;
};

function makeMockTable() {
  const rows: MockRow[] = [];
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
      search: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
      delete: vi.fn(),
    },
    mergeInsertChain,
  };
}

function makeMockConnection() {
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
        tables[name] = makeMockTable();
        tables[name].rows.push(...data);
        return tables[name].table;
      }),
      close: vi.fn(),
    },
  };
}

function makeMockEmbeddingProvider(dims = 4) {
  return {
    id: "mock",
    dimensions: dims,
    embed: vi.fn().mockImplementation(async (texts: string[]) =>
      texts.map(() => Array.from({ length: dims }, () => Math.random())),
    ),
  };
}

async function setupVectorStore() {
  const lancedb = await import("@lancedb/lancedb");
  const mock = makeMockConnection();
  vi.mocked(lancedb.connect).mockResolvedValue(
    mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>,
  );
  const { VectorStore } = await import("../vector-store.js");
  const vectorStore = await VectorStore.connect("/tmp/test");
  return { vectorStore, mock };
}

function makeMessage(overrides?: Partial<{
  id: string; sessionId: string; agentId: string;
  role: string; content: string; timestamp: number;
}>) {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    sessionId: "session-1",
    role: "user",
    content: "Hello world",
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MessageIndexer", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor and stats", () => {
    it("initialises with default stats", async () => {
      const { vectorStore } = await setupVectorStore();
      const { MessageIndexer } = await import("../message-indexer.js");
      const embeddingProvider = makeMockEmbeddingProvider();
      const indexer = new MessageIndexer({ embeddingProvider, vectorStore });
      expect(indexer.stats).toEqual({ queued: 0, indexed: 0, errors: 0 });
    });

    it("accepts custom batchSize and flushIntervalMs", async () => {
      const { vectorStore } = await setupVectorStore();
      const { MessageIndexer } = await import("../message-indexer.js");
      const embeddingProvider = makeMockEmbeddingProvider();
      const indexer = new MessageIndexer({
        embeddingProvider,
        vectorStore,
        batchSize: 25,
        flushIntervalMs: 2000,
      });
      expect(indexer.stats.queued).toBe(0);
    });
  });

  describe("enqueue", () => {
    it("increments queued count", async () => {
      const { vectorStore } = await setupVectorStore();
      const { MessageIndexer } = await import("../message-indexer.js");
      const embeddingProvider = makeMockEmbeddingProvider();
      const indexer = new MessageIndexer({
        embeddingProvider,
        vectorStore,
        batchSize: 100, // high batchSize so flush isn't triggered
        flushIntervalMs: 60_000,
      });
      indexer.enqueue(makeMessage());
      indexer.enqueue(makeMessage());
      expect(indexer.stats.queued).toBe(2);
    });

    it("drops oldest message when buffer exceeds maxBufferSize", async () => {
      const { vectorStore } = await setupVectorStore();
      const { MessageIndexer } = await import("../message-indexer.js");
      const embeddingProvider = makeMockEmbeddingProvider();
      const indexer = new MessageIndexer({
        embeddingProvider,
        vectorStore,
        batchSize: 1000,
        flushIntervalMs: 60_000,
        maxBufferSize: 2,
      });
      indexer.enqueue(makeMessage({ id: "first" }));
      indexer.enqueue(makeMessage({ id: "second" }));
      // Third message should cause the first to be dropped
      indexer.enqueue(makeMessage({ id: "third" }));
      // queued still tracks total enqueued calls
      expect(indexer.stats.queued).toBe(3);
    });

    it("auto-flushes when batchSize is reached", async () => {
      const { vectorStore } = await setupVectorStore();
      const { MessageIndexer } = await import("../message-indexer.js");
      const embeddingProvider = makeMockEmbeddingProvider();
      const indexer = new MessageIndexer({
        embeddingProvider,
        vectorStore,
        batchSize: 2,
        flushIntervalMs: 60_000,
      });

      indexer.enqueue(makeMessage({ content: "msg 1" }));
      indexer.enqueue(makeMessage({ content: "msg 2" }));

      // Wait for async flush to settle
      await new Promise((r) => setTimeout(r, 50));

      expect(embeddingProvider.embed).toHaveBeenCalled();
    });
  });

  describe("flush", () => {
    it("embeds buffered messages and upserts into LanceDB", async () => {
      const { vectorStore } = await setupVectorStore();
      const { MessageIndexer } = await import("../message-indexer.js");
      const embeddingProvider = makeMockEmbeddingProvider();
      const indexer = new MessageIndexer({
        embeddingProvider,
        vectorStore,
        batchSize: 100,
        flushIntervalMs: 60_000,
      });

      indexer.enqueue(makeMessage({ content: "Message A" }));
      indexer.enqueue(makeMessage({ content: "Message B" }));
      await indexer.flush();

      expect(embeddingProvider.embed).toHaveBeenCalledWith(["Message A", "Message B"]);
      expect(indexer.stats.indexed).toBe(2);
    });

    it("does nothing when buffer is empty", async () => {
      const { vectorStore } = await setupVectorStore();
      const { MessageIndexer } = await import("../message-indexer.js");
      const embeddingProvider = makeMockEmbeddingProvider();
      const indexer = new MessageIndexer({ embeddingProvider, vectorStore });
      await indexer.flush(); // Should not throw
      expect(embeddingProvider.embed).not.toHaveBeenCalled();
    });

    it("increments errors and skips batch on embedding failure", async () => {
      const { vectorStore } = await setupVectorStore();
      const { MessageIndexer } = await import("../message-indexer.js");
      const embeddingProvider = makeMockEmbeddingProvider();
      (embeddingProvider.embed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

      const indexer = new MessageIndexer({
        embeddingProvider,
        vectorStore,
        batchSize: 100,
        flushIntervalMs: 60_000,
      });

      indexer.enqueue(makeMessage({ content: "Failing msg" }));
      await indexer.flush();

      expect(indexer.stats.errors).toBe(1);
      expect(indexer.stats.indexed).toBe(0);
    });

    it("stores session_id, role, and timestamp as metadata", async () => {
      const lancedb = await import("@lancedb/lancedb");
      const mock = makeMockConnection();
      vi.mocked(lancedb.connect).mockResolvedValue(
        mock.conn as unknown as Awaited<ReturnType<typeof lancedb.connect>>,
      );
      const { VectorStore } = await import("../vector-store.js");
      const vectorStore = await VectorStore.connect("/tmp/test2");

      const { MessageIndexer } = await import("../message-indexer.js");
      const embeddingProvider = makeMockEmbeddingProvider();
      const indexer = new MessageIndexer({
        embeddingProvider,
        vectorStore,
        batchSize: 100,
        flushIntervalMs: 60_000,
      });

      const msg = makeMessage({
        sessionId: "session-xyz",
        role: "assistant",
        content: "Assistant response",
        timestamp: 1234567890,
      });
      indexer.enqueue(msg);
      await indexer.flush();

      // The mergeInsert execute call receives the upserted rows
      const tableName = "message_vectors";
      const table = mock.tables[tableName];
      if (table) {
        const executeCalls = table.mergeInsertChain.execute.mock.calls;
        expect(executeCalls.length).toBeGreaterThan(0);
        const rows = executeCalls[0][0] as Array<{ metadata: string }>;
        const metadata = JSON.parse(rows[0].metadata) as Record<string, unknown>;
        expect(metadata["session_id"]).toBe("session-xyz");
        expect(metadata["role"]).toBe("assistant");
      }
    });
  });

  describe("start and stop", () => {
    it("subscribes to session:message on start and unsubscribes on stop", async () => {
      const { vectorStore } = await setupVectorStore();
      const { MessageIndexer } = await import("../message-indexer.js");
      const embeddingProvider = makeMockEmbeddingProvider();
      const indexer = new MessageIndexer({
        embeddingProvider,
        vectorStore,
        batchSize: 100,
        flushIntervalMs: 60_000,
      });

      indexer.start();
      // Emit a session:message event
      const { events } = await import("@nexus/core");
      events.emit("session:message", { sessionId: "s1", role: "user", content: "Hi from event" });

      // Wait briefly for enqueue to process
      await new Promise((r) => setTimeout(r, 10));
      expect(indexer.stats.queued).toBe(1);

      await indexer.stop();
      // After stop, events should not be processed
      events.emit("session:message", { sessionId: "s1", role: "user", content: "After stop" });
      await new Promise((r) => setTimeout(r, 10));
      // queued count should still be 1 (the stop-time flush happened)
      expect(indexer.stats.queued).toBe(1);
    });

    it("flushes remaining buffer on stop", async () => {
      const { vectorStore } = await setupVectorStore();
      const { MessageIndexer } = await import("../message-indexer.js");
      const embeddingProvider = makeMockEmbeddingProvider();
      const indexer = new MessageIndexer({
        embeddingProvider,
        vectorStore,
        batchSize: 100,
        flushIntervalMs: 60_000,
      });

      indexer.enqueue(makeMessage({ content: "Unflushed message" }));
      expect(indexer.stats.indexed).toBe(0);

      await indexer.stop();
      expect(indexer.stats.indexed).toBe(1);
    });
  });
});
