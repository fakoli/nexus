/**
 * Unit tests for TelegramAdapter, escapeMarkdownV2, and normaliseMessage.
 *
 * The underlying TelegramBot is mocked with vi.spyOn so no real fetch calls
 * are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramAdapter, escapeMarkdownV2, normaliseMessage } from "../adapter.js";
import { TelegramBotError } from "../bot.js";
import type { TelegramUpdate, TelegramMessage, InboundMessage } from "../types.js";

// ── Fixtures ─────────────────────────────────────────────────────────

const BASE_MSG: TelegramMessage = {
  message_id: 42,
  from: { id: 99, is_bot: false, first_name: "Alice", username: "alice" },
  chat: { id: 1001, type: "private" },
  date: 1_700_000_000,
  text: "Hello, world!",
};

const BASE_UPDATE: TelegramUpdate = {
  update_id: 7,
  message: BASE_MSG,
};

const SENT_MESSAGE: TelegramMessage = {
  message_id: 100,
  chat: { id: 1001, type: "private" },
  date: 1_700_000_001,
  text: "reply",
};

// ── escapeMarkdownV2 ──────────────────────────────────────────────────

describe("escapeMarkdownV2", () => {
  it("escapes underscores", () => {
    expect(escapeMarkdownV2("hello_world")).toBe("hello\\_world");
  });

  it("escapes asterisks", () => {
    expect(escapeMarkdownV2("**bold**")).toBe("\\*\\*bold\\*\\*");
  });

  it("escapes dots", () => {
    expect(escapeMarkdownV2("v1.2.3")).toBe("v1\\.2\\.3");
  });

  it("escapes parentheses and square brackets", () => {
    expect(escapeMarkdownV2("[link](url)")).toBe("\\[link\\]\\(url\\)");
  });

  it("leaves plain alphanumeric text unchanged", () => {
    expect(escapeMarkdownV2("Hello World 123")).toBe("Hello World 123");
  });

  it("escapes all special chars in a complex string", () => {
    const raw = "1+1=2! #tag ~tilde `code` >quote {brace}|pipe";
    const result = escapeMarkdownV2(raw);
    expect(result).toContain("\\+");
    expect(result).toContain("\\=");
    expect(result).toContain("\\!");
    expect(result).toContain("\\#");
    expect(result).toContain("\\~");
    expect(result).toContain("\\`");
    expect(result).toContain("\\>");
    expect(result).toContain("\\{");
    expect(result).toContain("\\}");
    expect(result).toContain("\\|");
  });
});

// ── normaliseMessage ──────────────────────────────────────────────────

describe("normaliseMessage", () => {
  it("maps text message to InboundMessage correctly", () => {
    const result = normaliseMessage(BASE_UPDATE, BASE_MSG);
    expect(result).not.toBeNull();
    expect(result!.chatId).toBe("1001");
    expect(result!.messageId).toBe(42);
    expect(result!.text).toBe("Hello, world!");
    expect(result!.from.id).toBe(99);
    expect(result!.from.firstName).toBe("Alice");
    expect(result!.from.username).toBe("alice");
    expect(result!.from.isBot).toBe(false);
  });

  it("returns null for messages with no text, photo, or document", () => {
    const emptyMsg: TelegramMessage = {
      message_id: 1,
      chat: { id: 1, type: "private" },
      date: 0,
    };
    expect(normaliseMessage({ update_id: 1 }, emptyMsg)).toBeNull();
  });

  it("uses caption when text is absent", () => {
    const captionMsg: TelegramMessage = {
      ...BASE_MSG,
      text: undefined,
      caption: "a photo caption",
      photo: [{ file_id: "f1", file_unique_id: "u1", width: 100, height: 100 }],
    };
    const result = normaliseMessage(BASE_UPDATE, captionMsg);
    expect(result?.text).toBe("a photo caption");
  });

  it("populates replyTo context when present", () => {
    const replyMsg: TelegramMessage = {
      ...BASE_MSG,
      reply_to_message: {
        message_id: 10,
        from: { id: 5, is_bot: false, first_name: "Bob" },
        chat: { id: 1001, type: "private" },
        date: 1_699_999_999,
        text: "original",
      },
    };
    const result = normaliseMessage(BASE_UPDATE, replyMsg);
    expect(result!.replyTo).toEqual({
      messageId: 10,
      text: "original",
      fromId: 5,
    });
  });

  it("handles missing from field (anonymous / forwarded message)", () => {
    const anonMsg: TelegramMessage = { ...BASE_MSG, from: undefined };
    const result = normaliseMessage(BASE_UPDATE, anonMsg);
    expect(result).not.toBeNull();
    expect(result!.from.firstName).toBe("Unknown");
  });

  it("converts unix timestamp to ISO-8601 string", () => {
    const result = normaliseMessage(BASE_UPDATE, BASE_MSG);
    expect(result!.timestamp).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it("preserves the raw update on the result", () => {
    const result = normaliseMessage(BASE_UPDATE, BASE_MSG);
    expect(result!.raw).toBe(BASE_UPDATE);
  });
});

// ── TelegramAdapter ───────────────────────────────────────────────────

describe("TelegramAdapter", () => {
  const FAKE_TOKEN = "111111:AABBCC";

  // Silence pino logger output during tests.
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // ── Construction ───────────────────────────────────────────────────

  it("throws when no token is provided and env var is absent", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(() => new TelegramAdapter()).toThrow(TelegramBotError);
  });

  it("constructs successfully when token is in env", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", FAKE_TOKEN);
    expect(() => new TelegramAdapter()).not.toThrow();
  });

  it("constructs successfully when token is passed in config", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(() => new TelegramAdapter({ token: FAKE_TOKEN })).not.toThrow();
  });

  // ── start / stop lifecycle ─────────────────────────────────────────

  it("start: begins polling and stop: halts it", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const adapter = new TelegramAdapter({ token: FAKE_TOKEN });

    // Spy on bot methods — startPolling resolves immediately when stopPolling is called.
    const startSpy = vi
      .spyOn(
        (adapter as unknown as { bot: { startPolling: () => Promise<void>; stopPolling: () => void } }).bot,
        "startPolling",
      )
      .mockImplementation(async () => {
        // Simulate the loop finishing after stop is called.
      });

    const stopSpy = vi
      .spyOn(
        (adapter as unknown as { bot: { startPolling: () => Promise<void>; stopPolling: () => void } }).bot,
        "stopPolling",
      )
      .mockImplementation(() => {});

    const pollPromise = adapter.start(() => {});
    expect(adapter.isRunning).toBe(true);

    await adapter.stop();
    expect(adapter.isRunning).toBe(false);

    await pollPromise;

    expect(startSpy).toHaveBeenCalledOnce();
    expect(stopSpy).toHaveBeenCalledOnce();
  });

  it("start: throws if called while already running", async () => {
    const adapter = new TelegramAdapter({ token: FAKE_TOKEN });

    vi.spyOn(
      (adapter as unknown as { bot: { startPolling: () => Promise<void> } }).bot,
      "startPolling",
    ).mockResolvedValue(undefined);

    adapter.start(() => {}); // don't await
    expect(() => adapter.start(() => {})).toThrow("already running");

    await adapter.stop();
  });

  // ── sendReply ──────────────────────────────────────────────────────

  it("sendReply: auto-escapes MarkdownV2 chars by default", async () => {
    const adapter = new TelegramAdapter({ token: FAKE_TOKEN });

    const sendSpy = vi
      .spyOn(
        (adapter as unknown as { bot: { sendMessage: () => Promise<TelegramMessage> } }).bot,
        "sendMessage",
      )
      .mockResolvedValue(SENT_MESSAGE);

    await adapter.sendReply("1001", "Hello_World!");

    expect(sendSpy).toHaveBeenCalledOnce();
    const [, text, opts] = sendSpy.mock.calls[0] as unknown as [string, string, { parse_mode?: string }];
    // Underscores and exclamation marks should be escaped.
    expect(text).toContain("\\_");
    expect(text).toContain("\\!");
    expect(opts.parse_mode).toBe("MarkdownV2");
  });

  it("sendReply: skips escaping when raw:true is passed", async () => {
    const adapter = new TelegramAdapter({ token: FAKE_TOKEN });

    const sendSpy = vi
      .spyOn(
        (adapter as unknown as { bot: { sendMessage: () => Promise<TelegramMessage> } }).bot,
        "sendMessage",
      )
      .mockResolvedValue(SENT_MESSAGE);

    await adapter.sendReply("1001", "_raw_", { raw: true });

    const [, text] = sendSpy.mock.calls[0] as unknown as [string, string];
    expect(text).toBe("_raw_");
  });

  it("sendReply: sends plain text when parseMode is null", async () => {
    const adapter = new TelegramAdapter({ token: FAKE_TOKEN });

    const sendSpy = vi
      .spyOn(
        (adapter as unknown as { bot: { sendMessage: () => Promise<TelegramMessage> } }).bot,
        "sendMessage",
      )
      .mockResolvedValue(SENT_MESSAGE);

    await adapter.sendReply("1001", "plain text", { parseMode: null });

    const [, , opts] = sendSpy.mock.calls[0] as unknown as [string, string, { parse_mode?: string }];
    expect(opts.parse_mode).toBeUndefined();
  });

  // ── sendMedia ──────────────────────────────────────────────────────

  it("sendMedia: uses sendPhoto endpoint for image/* mime types", async () => {
    const adapter = new TelegramAdapter({ token: FAKE_TOKEN });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({ ok: true, result: SENT_MESSAGE }),
      } as unknown as Response),
    );

    await adapter.sendMedia("1001", new Uint8Array([1, 2, 3]), "image/png");

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("sendPhoto");

    vi.unstubAllGlobals();
  });

  it("sendMedia: uses sendDocument endpoint for non-image mime types", async () => {
    const adapter = new TelegramAdapter({ token: FAKE_TOKEN });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({ ok: true, result: SENT_MESSAGE }),
      } as unknown as Response),
    );

    await adapter.sendMedia("1001", new Uint8Array([1, 2, 3]), "application/pdf");

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("sendDocument");

    vi.unstubAllGlobals();
  });

  it("sendMedia: throws TelegramBotError on network failure", async () => {
    const adapter = new TelegramAdapter({ token: FAKE_TOKEN });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("timeout")),
    );

    await expect(
      adapter.sendMedia("1001", new Uint8Array([1]), "image/jpeg"),
    ).rejects.toThrow(TelegramBotError);

    vi.unstubAllGlobals();
  });

  // ── message handler routing ────────────────────────────────────────

  it("routes edited_message updates to the handler", async () => {
    const adapter = new TelegramAdapter({ token: FAKE_TOKEN });

    const editedUpdate: TelegramUpdate = {
      update_id: 8,
      edited_message: { ...BASE_MSG, text: "edited text" },
    };

    const received: InboundMessage[] = [];
    const handler = (msg: InboundMessage) => { received.push(msg); };

    // Directly invoke the private method to test routing without polling.
    await (
      adapter as unknown as { _handleUpdate: (u: TelegramUpdate) => Promise<void> }
    )._handleUpdate(editedUpdate);

    // Handler not yet registered — nothing received.
    expect(received).toHaveLength(0);

    // Simulate handler registration then call again.
    (adapter as unknown as { handler: MessageHandler | null }).handler = handler;
    await (
      adapter as unknown as { _handleUpdate: (u: TelegramUpdate) => Promise<void> }
    )._handleUpdate(editedUpdate);

    expect(received).toHaveLength(1);
    expect(received[0].text).toBe("edited text");
  });

  type MessageHandler = (msg: InboundMessage) => void | Promise<void>;
});
