/**
 * MessageIndexer — micro-batching pipeline that auto-indexes messages into LanceDB.
 *
 * Listens for "session:message" events, buffers them, and flushes to
 * LanceDB in batches (by size or by time interval).
 */
import { events, createLogger } from "@nexus/core";
import type { EmbeddingProvider } from "./embeddings.js";
import type { VectorStore } from "./vector-store.js";

const log = createLogger("rag:message-indexer");

const MESSAGE_TABLE = "message_vectors";

export interface IndexedMessage {
  id: string;
  sessionId: string;
  agentId?: string;
  role: string;
  content: string;
  timestamp: number;
}

export interface MessageIndexerOptions {
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  batchSize?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
}

export interface MessageIndexerStats {
  queued: number;
  indexed: number;
  errors: number;
}

// ── MessageIndexer ────────────────────────────────────────────────────────────

export class MessageIndexer {
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly vectorStore: VectorStore;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;

  private buffer: IndexedMessage[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private _stats: MessageIndexerStats = { queued: 0, indexed: 0, errors: 0 };
  private _flushing = false;

  // Event handler reference for cleanup
  private readonly _onSessionMessage: (e: { sessionId: string; role: string; content: string }) => void;

  constructor(options: MessageIndexerOptions) {
    this.embeddingProvider = options.embeddingProvider;
    this.vectorStore = options.vectorStore;
    this.batchSize = options.batchSize ?? 50;
    this.flushIntervalMs = options.flushIntervalMs ?? 5000;
    this.maxBufferSize = options.maxBufferSize ?? 10000;

    this._onSessionMessage = (e) => {
      // The session:message event doesn't carry an id, so we generate one.
      const msg: IndexedMessage = {
        id: `${e.sessionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sessionId: e.sessionId,
        role: e.role,
        content: e.content,
        timestamp: Date.now(),
      };
      this.enqueue(msg);
    };
  }

  get stats(): MessageIndexerStats {
    return { ...this._stats };
  }

  /** Start listening for session:message events and begin periodic flushing. */
  start(): void {
    events.on("session:message", this._onSessionMessage);
    this.flushTimer = setInterval(() => {
      this.flush().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg }, "Periodic flush error");
      });
    }, this.flushIntervalMs);
    log.info({ batchSize: this.batchSize, flushIntervalMs: this.flushIntervalMs }, "MessageIndexer started");
  }

  /** Queue a message for indexing. Triggers flush if buffer is full. */
  enqueue(message: IndexedMessage): void {
    if (this.buffer.length >= this.maxBufferSize) {
      log.warn(
        { bufferSize: this.buffer.length, maxBufferSize: this.maxBufferSize },
        "Buffer full — dropping oldest message",
      );
      this.buffer.shift();
    }

    this.buffer.push(message);
    this._stats.queued++;

    if (this.buffer.length >= this.batchSize) {
      this.flush().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg }, "Batch flush error");
      });
    }
  }

  /** Force-flush the current buffer to LanceDB. */
  async flush(): Promise<void> {
    if (this._flushing || this.buffer.length === 0) return;
    this._flushing = true;

    const batch = this.buffer.splice(0, this.batchSize);
    log.info({ batchSize: batch.length }, "Flushing message batch");

    try {
      const texts = batch.map((m) => m.content);
      const embeddings = await this.embeddingProvider.embed(texts);

      const table = await this.vectorStore.getOrCreateTable(MESSAGE_TABLE);
      await table.upsert(
        batch.map((msg, i) => ({
          id: msg.id,
          vector: embeddings[i] ?? [],
          content: msg.content,
          metadata: {
            session_id: msg.sessionId,
            agent_id: msg.agentId ?? "",
            role: msg.role,
            timestamp: msg.timestamp,
          },
        })),
      );

      this._stats.indexed += batch.length;
      log.info({ indexed: batch.length }, "Batch indexed successfully");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg, batchSize: batch.length }, "Failed to index batch; messages dropped");
      this._stats.errors += batch.length;
    } finally {
      this._flushing = false;
    }
  }

  /** Stop the indexer, flush remaining buffer, and remove event listeners. */
  async stop(): Promise<void> {
    events.off("session:message", this._onSessionMessage);
    if (this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    // Flush whatever remains
    while (this.buffer.length > 0) {
      await this.flush();
    }
    log.info({ stats: this._stats }, "MessageIndexer stopped");
  }
}
