import { describe, it, expect, vi } from "vitest";
import { ChannelStream } from "@nexus/core";
import type { ChannelMessage, ChannelObservation } from "@nexus/core";
import { ChannelResponder } from "../channel-responder.js";

function makeMsg(id: string, content: string, userId = "u1"): ChannelMessage {
  return {
    id,
    channelId: "ch1",
    platform: "discord",
    userId,
    userName: "User",
    content,
    timestamp: Date.now(),
  };
}

function makeConfig(overrides: Partial<ChannelObservation> = {}): ChannelObservation {
  return {
    mode: "active",
    autoIndex: false,
    cooldownMs: 0,
    ...overrides,
  };
}

async function runResponder(
  messages: ChannelMessage[],
  config: ChannelObservation,
  options: { botUserId?: string; botName?: string } = {},
): Promise<{ responded: ChannelMessage[]; stats: ChannelResponder["stats"] }> {
  const stream = new ChannelStream();
  for (const m of messages) stream.push(m);
  stream.close();

  const responded: ChannelMessage[] = [];
  const onRespond = vi.fn(async (msg: ChannelMessage) => {
    responded.push(msg);
  });

  const responder = new ChannelResponder({
    stream,
    config,
    onRespond,
    ...options,
  });

  await responder.start();
  return { responded, stats: responder.stats };
}

describe("ChannelResponder", () => {
  it("mode=active responds to all messages", async () => {
    const msgs = [makeMsg("1", "hello"), makeMsg("2", "world")];
    const { responded, stats } = await runResponder(msgs, makeConfig({ mode: "active" }));
    expect(responded).toHaveLength(2);
    expect(stats.responded).toBe(2);
    expect(stats.skipped).toBe(0);
  });

  it("mode=off skips all messages", async () => {
    const msgs = [makeMsg("1", "hello")];
    const { responded, stats } = await runResponder(msgs, makeConfig({ mode: "off" }));
    expect(responded).toHaveLength(0);
    expect(stats.skipped).toBe(1);
  });

  it("mode=observe never responds", async () => {
    const msgs = [makeMsg("1", "hello"), makeMsg("2", "world")];
    const { responded, stats } = await runResponder(msgs, makeConfig({ mode: "observe" }));
    expect(responded).toHaveLength(0);
    expect(stats.received).toBe(2);
    expect(stats.skipped).toBe(2);
  });

  it("mode=mention-only responds only when bot name is in content", async () => {
    const msgs = [
      makeMsg("1", "Hey @nexus what time is it"),
      makeMsg("2", "Just a regular message"),
      makeMsg("3", "NEXUS help me"),
    ];
    const { responded } = await runResponder(
      msgs,
      makeConfig({ mode: "mention-only" }),
      { botName: "nexus" },
    );
    expect(responded).toHaveLength(2);
    expect(responded[0]?.id).toBe("1");
    expect(responded[1]?.id).toBe("3");
  });

  it("mode=mention-only with no botName responds to nothing", async () => {
    const msgs = [makeMsg("1", "@nexus hi")];
    const { responded } = await runResponder(
      msgs,
      makeConfig({ mode: "mention-only" }),
      { botName: "" },
    );
    expect(responded).toHaveLength(0);
  });

  it("skips messages from the bot itself", async () => {
    const msgs = [makeMsg("1", "I am the bot", "BOT_ID")];
    const { responded } = await runResponder(
      msgs,
      makeConfig({ mode: "active" }),
      { botUserId: "BOT_ID" },
    );
    expect(responded).toHaveLength(0);
  });

  it("respects cooldownMs between responses", async () => {
    const msgs = [
      makeMsg("1", "first"),
      makeMsg("2", "second"),
      makeMsg("3", "third"),
    ];
    const config = makeConfig({ mode: "active", cooldownMs: 60_000 }); // 60s cooldown
    const { responded, stats } = await runResponder(msgs, config);
    // Only the first message passes; the next two are within cooldown
    expect(responded).toHaveLength(1);
    expect(stats.skipped).toBe(2);
  });

  it("stats.received counts all messages regardless of mode", async () => {
    const msgs = [makeMsg("1", "a"), makeMsg("2", "b"), makeMsg("3", "c")];
    const { stats } = await runResponder(msgs, makeConfig({ mode: "off" }));
    expect(stats.received).toBe(3);
  });

  it("stop() halts consumption", async () => {
    const stream = new ChannelStream();
    stream.push(makeMsg("x", "msg"));

    const responded: ChannelMessage[] = [];
    const responder = new ChannelResponder({
      stream,
      config: makeConfig({ mode: "active" }),
      onRespond: async (m) => { responded.push(m); },
    });

    responder.stop(); // stop before start
    stream.close();
    await responder.start();

    // Stopped immediately, so 0 responses
    expect(responded).toHaveLength(0);
  });
});
