/**
 * ChannelStream — async iterable buffer for messages arriving from channel adapters.
 *
 * Messages are pushed in by adapters and consumed by stream consumers
 * (e.g. StreamIndexer, ChannelResponder) via the async iterator protocol.
 */
import { createLogger } from "../logger.js";

const log = createLogger("core:channel-stream");

const DEFAULT_MAX_BUFFER = 1000;

export interface ChannelMessage {
  id: string;
  channelId: string;
  platform: string;
  userId: string;
  userName: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

type Resolver = (value: IteratorResult<ChannelMessage>) => void;

export class ChannelStream implements AsyncIterable<ChannelMessage> {
  private readonly maxBufferSize: number;
  private readonly buffer: ChannelMessage[] = [];
  private closed = false;
  /** Pending resolve from an awaiting iterator — at most one at a time. */
  private pendingResolve: Resolver | null = null;

  constructor(options?: { maxBufferSize?: number }) {
    this.maxBufferSize = options?.maxBufferSize ?? DEFAULT_MAX_BUFFER;
  }

  /** Push a message into the stream. Drops oldest if buffer is full. */
  push(msg: ChannelMessage): void {
    if (this.closed) {
      log.warn({ id: msg.id }, "Push on closed ChannelStream — ignoring");
      return;
    }

    if (this.buffer.length >= this.maxBufferSize) {
      const dropped = this.buffer.shift();
      log.warn(
        { dropped: dropped?.id, bufferSize: this.buffer.length, maxBufferSize: this.maxBufferSize },
        "ChannelStream buffer full — dropped oldest message",
      );
    }

    this.buffer.push(msg);

    // If a consumer is waiting, hand it the message immediately.
    if (this.pendingResolve !== null) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      const next = this.buffer.shift();
      if (next !== undefined) {
        resolve({ value: next, done: false });
      }
    }
  }

  /** Signal that no more messages will arrive. Ends any active iteration. */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.pendingResolve !== null) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      resolve({ value: undefined as unknown as ChannelMessage, done: true });
    }

    log.debug("ChannelStream closed");
  }

  [Symbol.asyncIterator](): AsyncIterator<ChannelMessage> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const stream = this;

    return {
      next(): Promise<IteratorResult<ChannelMessage>> {
        // If there are buffered messages, yield immediately.
        if (stream.buffer.length > 0) {
          const msg = stream.buffer.shift();
          if (msg !== undefined) {
            return Promise.resolve({ value: msg, done: false });
          }
        }

        // If the stream is closed and buffer is empty, end iteration.
        if (stream.closed) {
          return Promise.resolve({ value: undefined as unknown as ChannelMessage, done: true });
        }

        // Otherwise, park until push() or close() wakes us up.
        return new Promise<IteratorResult<ChannelMessage>>((resolve) => {
          stream.pendingResolve = resolve;
        });
      },
    };
  }
}
