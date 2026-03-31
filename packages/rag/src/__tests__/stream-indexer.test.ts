import { describe, it, expect, vi } from "vitest";
import { ChannelStream } from "@nexus/core";
import type { ChannelMessage } from "@nexus/core";
import { StreamIndexer } from "../stream-indexer.js";
import type { MessageIndexer } from "../message-indexer.js";
import type { IndexedMessage } from "../message-indexer.js";

function makeMsg(id: string, content = "hello"): ChannelMessage {
  return {
    id,
    channelId: "ch1",
    platform: "discord",
    userId: "u1",
    userName: "Alice",
    content,
    timestamp: Date.now(),
  };
}

function makeMockIndexer(): MessageIndexer & { enqueued: IndexedMessage[] } {
  const enqueued: IndexedMessage[] = [];
  return {
    enqueued,
    enqueue(msg: IndexedMessage) {
      enqueued.push(msg);
    },
    // Stub all other methods
    start: vi.fn(),
    stop: vi.fn(),
    flush: vi.fn(),
    get stats() { return { queued: 0, indexed: 0, errors: 0 }; },
  } as unknown as MessageIndexer & { enqueued: IndexedMessage[] };
}

describe("StreamIndexer", () => {
  it("indexes messages when autoIndex=true", async () => {
    const stream = new ChannelStream();
    const indexer = makeMockIndexer();
    const si = new StreamIndexer({ stream, indexer, autoIndex: true });

    stream.push(makeMsg("1", "first message"));
    stream.push(makeMsg("2", "second message"));
    stream.close();

    await si.start();

    expect(indexer.enqueued).toHaveLength(2);
    expect(si.stats.processed).toBe(2);
    expect(si.stats.skipped).toBe(0);
  });

  it("skips messages when autoIndex=false", async () => {
    const stream = new ChannelStream();
    const indexer = makeMockIndexer();
    const si = new StreamIndexer({ stream, indexer, autoIndex: false });

    stream.push(makeMsg("a", "should be skipped"));
    stream.close();

    await si.start();

    expect(indexer.enqueued).toHaveLength(0);
    expect(si.stats.skipped).toBe(1);
    expect(si.stats.processed).toBe(0);
  });

  it("skips empty content messages", async () => {
    const stream = new ChannelStream();
    const indexer = makeMockIndexer();
    const si = new StreamIndexer({ stream, indexer, autoIndex: true });

    stream.push(makeMsg("e1", ""));
    stream.push(makeMsg("e2", "   "));
    stream.push(makeMsg("e3", "real content"));
    stream.close();

    await si.start();

    expect(indexer.enqueued).toHaveLength(1);
    expect(indexer.enqueued[0]?.id).toBe("e3");
    expect(si.stats.skipped).toBe(2);
  });

  it("deduplicates messages with the same id", async () => {
    const stream = new ChannelStream();
    const indexer = makeMockIndexer();
    const si = new StreamIndexer({ stream, indexer, autoIndex: true });

    stream.push(makeMsg("dup", "first occurrence"));
    stream.push(makeMsg("dup", "second occurrence"));
    stream.close();

    await si.start();

    expect(indexer.enqueued).toHaveLength(1);
    expect(si.stats.processed).toBe(1);
    expect(si.stats.skipped).toBe(1);
  });

  it("stop() halts consumption mid-stream", async () => {
    const stream = new ChannelStream();
    const indexer = makeMockIndexer();
    const si = new StreamIndexer({ stream, indexer, autoIndex: true });

    // Pre-fill buffer with two messages
    stream.push(makeMsg("s1", "msg one"));
    stream.push(makeMsg("s2", "msg two"));

    // Stop before starting — will break immediately
    si.stop();
    stream.close();

    await si.start();
    // Processed should be 0 since stopped=true before loop body
    expect(si.stats.processed).toBe(0);
  });

  it("stats.processed and stats.skipped reflect correct counts", async () => {
    const stream = new ChannelStream();
    const indexer = makeMockIndexer();
    const si = new StreamIndexer({ stream, indexer, autoIndex: true });

    stream.push(makeMsg("p1", "good"));
    stream.push(makeMsg("p2", ""));     // skipped: empty
    stream.push(makeMsg("p1", "dup"));  // skipped: duplicate
    stream.close();

    await si.start();

    expect(si.stats.processed).toBe(1);
    expect(si.stats.skipped).toBe(2);
  });

  it("defaults autoIndex to true", async () => {
    const stream = new ChannelStream();
    const indexer = makeMockIndexer();
    // No autoIndex option — should default to true
    const si = new StreamIndexer({ stream, indexer });

    stream.push(makeMsg("d1", "default auto"));
    stream.close();

    await si.start();
    expect(indexer.enqueued).toHaveLength(1);
  });
});
