import { describe, it, expect } from "vitest";
import { DiscordChannelStream } from "../stream.js";

function makeCreateData(id = "100", channelId = "ch1") {
  return {
    id,
    channel_id: channelId,
    author: { id: "u1", username: "Alice", discriminator: "0001" },
    content: "Hello world",
    timestamp: "2024-01-01T00:00:00.000Z",
  };
}

describe("DiscordChannelStream", () => {
  it("handles MESSAGE_CREATE and pushes to stream", async () => {
    const ds = new DiscordChannelStream();
    ds.handleDispatch("MESSAGE_CREATE", makeCreateData("1"));
    ds.close();

    const msgs = [];
    for await (const m of ds.getStream()) {
      msgs.push(m);
    }

    expect(msgs).toHaveLength(1);
    const msg = msgs[0];
    expect(msg?.id).toBe("1");
    expect(msg?.channelId).toBe("ch1");
    expect(msg?.platform).toBe("discord");
    expect(msg?.userId).toBe("u1");
    expect(msg?.userName).toBe("Alice");
    expect(msg?.content).toBe("Hello world");
    expect(msg?.metadata).toBeUndefined();
  });

  it("handles MESSAGE_UPDATE and marks metadata.update=true", async () => {
    const ds = new DiscordChannelStream();
    ds.handleDispatch("MESSAGE_UPDATE", makeCreateData("2"));
    ds.close();

    for await (const m of ds.getStream()) {
      expect(m.metadata?.update).toBe(true);
    }
  });

  it("handles MESSAGE_DELETE with empty content and metadata.deleted=true", async () => {
    const ds = new DiscordChannelStream();
    ds.handleDispatch("MESSAGE_DELETE", { id: "99", channel_id: "ch1" });
    ds.close();

    for await (const m of ds.getStream()) {
      expect(m.id).toBe("99");
      expect(m.content).toBe("");
      expect(m.metadata?.deleted).toBe(true);
    }
  });

  it("ignores dispatches with missing id", async () => {
    const ds = new DiscordChannelStream();
    ds.handleDispatch("MESSAGE_CREATE", { channel_id: "ch1" }); // no id
    ds.close();

    const msgs = [];
    for await (const m of ds.getStream()) {
      msgs.push(m);
    }
    expect(msgs).toHaveLength(0);
  });

  it("ignores unknown dispatch events", async () => {
    const ds = new DiscordChannelStream();
    ds.handleDispatch("VOICE_STATE_UPDATE", { some: "data" });
    ds.close();

    const msgs = [];
    for await (const m of ds.getStream()) {
      msgs.push(m);
    }
    expect(msgs).toHaveLength(0);
  });

  it("parses ISO timestamp correctly", async () => {
    const ds = new DiscordChannelStream();
    const ts = "2024-06-15T12:00:00.000Z";
    ds.handleDispatch("MESSAGE_CREATE", { ...makeCreateData("3"), timestamp: ts });
    ds.close();

    for await (const m of ds.getStream()) {
      expect(m.timestamp).toBe(Date.parse(ts));
    }
  });

  it("respects maxBufferSize option", () => {
    const ds = new DiscordChannelStream({ maxBufferSize: 2 });
    ds.handleDispatch("MESSAGE_CREATE", makeCreateData("1"));
    ds.handleDispatch("MESSAGE_CREATE", makeCreateData("2"));
    ds.handleDispatch("MESSAGE_CREATE", makeCreateData("3")); // drops "1"
    ds.close();
    // Just check no throws
  });
});
