import { describe, it, expect } from "vitest";
import { TelegramChannelStream } from "../stream.js";

function makeMessageUpdate(
  messageId = 1,
  chatId = -100123,
  text = "Hello",
  fromId = 42,
  firstName = "Bob",
) {
  return {
    update_id: 1001,
    message: {
      message_id: messageId,
      from: { id: fromId, is_bot: false, first_name: firstName },
      chat: { id: chatId, type: "group" },
      date: 1700000000,
      text,
    },
  };
}

describe("TelegramChannelStream", () => {
  it("handles message update and pushes to stream", async () => {
    const ts = new TelegramChannelStream();
    ts.handleUpdate(makeMessageUpdate(1, -100123, "Hi there"));
    ts.close();

    const msgs = [];
    for await (const m of ts.getStream()) {
      msgs.push(m);
    }

    expect(msgs).toHaveLength(1);
    const msg = msgs[0];
    expect(msg?.platform).toBe("telegram");
    expect(msg?.channelId).toBe("-100123");
    expect(msg?.userId).toBe("42");
    expect(msg?.userName).toBe("Bob");
    expect(msg?.content).toBe("Hi there");
    expect(msg?.timestamp).toBe(1700000000 * 1000);
    expect(msg?.metadata).toBeUndefined();
  });

  it("handles channel_post update", async () => {
    const ts = new TelegramChannelStream();
    ts.handleUpdate({
      update_id: 1002,
      channel_post: {
        message_id: 5,
        chat: { id: -999, type: "channel" },
        date: 1700000001,
        text: "Channel post",
      },
    });
    ts.close();

    for await (const m of ts.getStream()) {
      expect(m.content).toBe("Channel post");
      expect(m.channelId).toBe("-999");
    }
  });

  it("handles edited_message with metadata.edited=true", async () => {
    const ts = new TelegramChannelStream();
    ts.handleUpdate({
      update_id: 1003,
      edited_message: {
        message_id: 7,
        from: { id: 10, is_bot: false, first_name: "Eve" },
        chat: { id: -200, type: "group" },
        date: 1700000002,
        text: "Edited text",
      },
    });
    ts.close();

    for await (const m of ts.getStream()) {
      expect(m.content).toBe("Edited text");
      expect(m.metadata?.edited).toBe(true);
    }
  });

  it("handles edited_channel_post with metadata.edited=true", async () => {
    const ts = new TelegramChannelStream();
    ts.handleUpdate({
      update_id: 1004,
      edited_channel_post: {
        message_id: 8,
        chat: { id: -300, type: "channel" },
        date: 1700000003,
        text: "Edited channel post",
      },
    });
    ts.close();

    for await (const m of ts.getStream()) {
      expect(m.metadata?.edited).toBe(true);
    }
  });

  it("id is composed of chatId-messageId", async () => {
    const ts = new TelegramChannelStream();
    ts.handleUpdate(makeMessageUpdate(42, -555));
    ts.close();

    for await (const m of ts.getStream()) {
      expect(m.id).toBe("-555-42");
    }
  });

  it("ignores updates with no recognised message fields", async () => {
    const ts = new TelegramChannelStream();
    ts.handleUpdate({ update_id: 9999, some_other_field: {} });
    ts.close();

    const msgs = [];
    for await (const m of ts.getStream()) {
      msgs.push(m);
    }
    expect(msgs).toHaveLength(0);
  });

  it("uses caption when text is absent", async () => {
    const ts = new TelegramChannelStream();
    ts.handleUpdate({
      update_id: 2000,
      message: {
        message_id: 10,
        from: { id: 1, is_bot: false, first_name: "Cap" },
        chat: { id: -1, type: "group" },
        date: 1700000010,
        caption: "Photo caption",
      },
    });
    ts.close();

    for await (const m of ts.getStream()) {
      expect(m.content).toBe("Photo caption");
    }
  });
});
