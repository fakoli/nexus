/**
 * StreamIndexer — bridges a ChannelStream to a MessageIndexer.
 *
 * Consumes ChannelMessage objects from a ChannelStream and feeds
 * non-empty, deduplicated messages to a MessageIndexer for vector indexing.
 */
import type { ChannelStream, ChannelMessage } from "@nexus/core";
import { createLogger } from "@nexus/core";
import type { MessageIndexer } from "./message-indexer.js";
import type { IndexedMessage } from "./message-indexer.js";

const log = createLogger("rag:stream-indexer");

const MAX_SEEN_IDS = 10_000;

export interface StreamIndexerStats {
  processed: number;
  skipped: number;
}

export class StreamIndexer {
  private readonly stream: ChannelStream;
  private readonly indexer: MessageIndexer;
  private readonly autoIndex: boolean;

  private stopped = false;
  private seenIds: Set<string> = new Set();
  private _stats: StreamIndexerStats = { processed: 0, skipped: 0 };

  constructor(options: {
    stream: ChannelStream;
    indexer: MessageIndexer;
    autoIndex?: boolean;
  }) {
    this.stream = options.stream;
    this.indexer = options.indexer;
    this.autoIndex = options.autoIndex ?? true;
  }

  get stats(): StreamIndexerStats {
    return { ...this._stats };
  }

  /** Stop consuming the stream. Any in-flight iteration will end on its next tick. */
  stop(): void {
    this.stopped = true;
  }

  /**
   * Start consuming from the stream and indexing messages.
   * Resolves when the stream is closed or stop() is called.
   */
  async start(): Promise<void> {
    log.info({ autoIndex: this.autoIndex }, "StreamIndexer starting");

    for await (const msg of this.stream) {
      if (this.stopped) break;
      this.processMessage(msg);
    }

    log.info({ stats: this._stats }, "StreamIndexer finished");
  }

  private processMessage(msg: ChannelMessage): void {
    // Skip empty content
    if (!msg.content.trim()) {
      this._stats.skipped++;
      log.debug({ id: msg.id }, "Skipping empty message");
      return;
    }

    // Deduplicate
    if (this.seenIds.has(msg.id)) {
      this._stats.skipped++;
      log.debug({ id: msg.id }, "Skipping duplicate message");
      return;
    }

    // Bound the seen-ids set
    if (this.seenIds.size >= MAX_SEEN_IDS) {
      // Remove an arbitrary entry (first insertion order)
      const first = this.seenIds.values().next().value;
      if (first !== undefined) {
        this.seenIds.delete(first);
      }
    }
    this.seenIds.add(msg.id);

    if (!this.autoIndex) {
      this._stats.skipped++;
      log.debug({ id: msg.id }, "autoIndex=false — skipping indexing");
      return;
    }

    const indexed: IndexedMessage = {
      id: msg.id,
      sessionId: msg.channelId,
      role: "user",
      content: msg.content,
      timestamp: msg.timestamp,
    };

    this.indexer.enqueue(indexed);
    this._stats.processed++;
    log.debug({ id: msg.id }, "Message enqueued for indexing");
  }
}
