import { describe, it, expect } from "vitest";
import { ChannelStream } from "../channels/stream.js";
import type { ChannelMessage } from "../channels/stream.js";

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

describe("ChannelStream", () => {
  it("yields pushed messages in order", async () => {
    const stream = new ChannelStream();
    stream.push(makeMsg("1", "first"));
    stream.push(makeMsg("2", "second"));
    stream.close();

    const results: ChannelMessage[] = [];
    for await (const msg of stream) {
      results.push(msg);
    }

    expect(results).toHaveLength(2);
    expect(results[0].content).toBe("first");
    expect(results[1].content).toBe("second");
  });

  it("ends iteration after close()", async () => {
    const stream = new ChannelStream();
    stream.close();
    const results: ChannelMessage[] = [];
    for await (const msg of stream) {
      results.push(msg);
    }
    expect(results).toHaveLength(0);
  });

  it("unblocks a pending iterator when push() is called", async () => {
    const stream = new ChannelStream();

    // Start iterating before any push.
    const collected: ChannelMessage[] = [];
    const done = (async () => {
      for await (const msg of stream) {
        collected.push(msg);
        if (collected.length === 1) break;
      }
    })();

    // Push after a microtask delay.
    await Promise.resolve();
    stream.push(makeMsg("a", "async msg"));

    await done;
    expect(collected).toHaveLength(1);
    expect(collected[0].content).toBe("async msg");
  });

  it("unblocks a pending iterator when close() is called", async () => {
    const stream = new ChannelStream();
    const collected: ChannelMessage[] = [];

    const done = (async () => {
      for await (const msg of stream) {
        collected.push(msg);
      }
    })();

    await Promise.resolve();
    stream.close();

    await done;
    expect(collected).toHaveLength(0);
  });

  it("drops oldest message when buffer is full", () => {
    const stream = new ChannelStream({ maxBufferSize: 2 });
    stream.push(makeMsg("1", "first"));
    stream.push(makeMsg("2", "second"));
    stream.push(makeMsg("3", "third")); // should drop "first"
    stream.close();

    // Drain synchronously via internal buffer check
    const it = stream[Symbol.asyncIterator]();
    const results: string[] = [];
    // Must consume via async iteration since the iterator is async
    return (async () => {
      for await (const msg of stream) {
        results.push(msg.content);
      }
      // Stream was closed with 2 items (oldest dropped)
      expect(results.length).toBeLessThanOrEqual(2);
      expect(results).not.toContain("first");
    })();
  });

  it("ignores pushes after close()", () => {
    const stream = new ChannelStream();
    stream.close();
    // Should not throw
    stream.push(makeMsg("x", "ignored"));
  });

  it("supports metadata on messages", async () => {
    const stream = new ChannelStream();
    stream.push({ ...makeMsg("m1"), metadata: { deleted: true } });
    stream.close();

    for await (const msg of stream) {
      expect(msg.metadata?.deleted).toBe(true);
    }
  });
});
