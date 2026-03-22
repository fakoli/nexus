/**
 * Unit tests for TelegramBot.
 *
 * fetch is replaced with vi.fn() throughout — no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramBot, TelegramBotError } from "../bot.js";
import type { TelegramUser, TelegramMessage, TelegramUpdate } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
}

function okResponse<T>(result: T) {
  return { ok: true, result };
}

function errResponse(code: number, description: string) {
  return { ok: false, error_code: code, description };
}

const FAKE_TOKEN = "123456:ABC-DEF";

const FAKE_USER: TelegramUser = {
  id: 42,
  is_bot: true,
  first_name: "TestBot",
  username: "test_bot",
};

const FAKE_MESSAGE: TelegramMessage = {
  message_id: 1,
  chat: { id: 100, type: "private" },
  date: 1_700_000_000,
  text: "hello",
};

const FAKE_UPDATE: TelegramUpdate = {
  update_id: 1,
  message: FAKE_MESSAGE,
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("TelegramBot", () => {
  let bot: TelegramBot;

  beforeEach(() => {
    bot = new TelegramBot(FAKE_TOKEN);
    vi.stubGlobal("fetch", mockFetch(okResponse(FAKE_USER)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ── Constructor ────────────────────────────────────────────────────

  it("throws TelegramBotError when constructed with an empty token", () => {
    expect(() => new TelegramBot("")).toThrow(TelegramBotError);
  });

  it("constructs successfully with a valid token", () => {
    expect(() => new TelegramBot(FAKE_TOKEN)).not.toThrow();
  });

  // ── getMe ──────────────────────────────────────────────────────────

  it("getMe: calls the correct URL and returns the user object", async () => {
    vi.stubGlobal("fetch", mockFetch(okResponse(FAKE_USER)));
    const result = await bot.getMe();

    expect(result).toEqual(FAKE_USER);
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain(`/bot${FAKE_TOKEN}/getMe`);
  });

  it("getMe: throws TelegramBotError on API-level error response", async () => {
    vi.stubGlobal("fetch", mockFetch(errResponse(401, "Unauthorized")));
    await expect(bot.getMe()).rejects.toThrow(TelegramBotError);
    await expect(bot.getMe()).rejects.toThrow("Unauthorized");
  });

  it("getMe: throws TelegramBotError when fetch itself rejects (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("DNS lookup failed")),
    );
    await expect(bot.getMe()).rejects.toThrow(TelegramBotError);
    await expect(bot.getMe()).rejects.toThrow("Network error");
  });

  // ── getUpdates ─────────────────────────────────────────────────────

  it("getUpdates: sends offset and timeout in the request body", async () => {
    vi.stubGlobal("fetch", mockFetch(okResponse([FAKE_UPDATE])));
    const updates = await bot.getUpdates(100, 30, 50);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual(FAKE_UPDATE);

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.offset).toBe(100);
    expect(body.timeout).toBe(30);
    expect(body.limit).toBe(50);
  });

  it("getUpdates: omits offset when not supplied", async () => {
    vi.stubGlobal("fetch", mockFetch(okResponse([])));
    await bot.getUpdates(undefined, 30);

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.offset).toBeUndefined();
  });

  it("getUpdates: passes allowed_updates when provided", async () => {
    vi.stubGlobal("fetch", mockFetch(okResponse([])));
    await bot.getUpdates(0, 30, 100, ["message"]);

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.allowed_updates).toEqual(["message"]);
  });

  // ── sendMessage ────────────────────────────────────────────────────

  it("sendMessage: sends chat_id, text and options in request body", async () => {
    vi.stubGlobal("fetch", mockFetch(okResponse(FAKE_MESSAGE)));
    const result = await bot.sendMessage(100, "hello world", {
      parse_mode: "MarkdownV2",
      reply_to_message_id: 5,
    });

    expect(result).toEqual(FAKE_MESSAGE);

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("sendMessage");
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe(100);
    expect(body.text).toBe("hello world");
    expect(body.parse_mode).toBe("MarkdownV2");
    expect(body.reply_to_message_id).toBe(5);
  });

  it("sendMessage: throws TelegramBotError when bot is blocked by user", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(errResponse(403, "Forbidden: bot was blocked by the user")),
    );
    await expect(bot.sendMessage(100, "hi")).rejects.toThrow(TelegramBotError);
  });

  // ── editMessage ────────────────────────────────────────────────────

  it("editMessage: calls editMessageText with correct params", async () => {
    vi.stubGlobal("fetch", mockFetch(okResponse(FAKE_MESSAGE)));
    await bot.editMessage(100, 1, "updated text");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("editMessageText");
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe(100);
    expect(body.message_id).toBe(1);
    expect(body.text).toBe("updated text");
  });

  // ── polling ────────────────────────────────────────────────────────

  it("startPolling: invokes onUpdate for each update and advances offset", async () => {
    const updates: TelegramUpdate[] = [
      { update_id: 10, message: FAKE_MESSAGE },
      { update_id: 11, message: FAKE_MESSAGE },
    ];

    // First call returns updates; second call stops the loop.
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        const result = callCount === 1 ? updates : [];
        if (callCount >= 2) bot.stopPolling();
        return Promise.resolve({
          json: () => Promise.resolve(okResponse(result)),
        } as unknown as Response);
      }),
    );

    const received: number[] = [];
    await bot.startPolling(
      (u) => { received.push(u.update_id); },
      0, // zero timeout so the test doesn't hang
    );

    expect(received).toEqual([10, 11]);

    // Second getUpdates call should have offset = 12 (11 + 1).
    const secondCallBody = JSON.parse(
      ((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit])[1].body as string,
    );
    expect(secondCallBody.offset).toBe(12);
  });

  it("stopPolling: sets isPolling to false", () => {
    bot.stopPolling();
    expect(bot.isPolling).toBe(false);
  });

  it("startPolling: recovers from a network error and continues polling", async () => {
    // Suppress sleep in backoff for test speed by replacing setTimeout globally.
    vi.useFakeTimers();

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("timeout"));
        }
        bot.stopPolling();
        return Promise.resolve({
          json: () => Promise.resolve(okResponse([])),
        } as unknown as Response);
      }),
    );

    const pollPromise = bot.startPolling(() => {}, 0);

    // Fast-forward timers to skip exponential backoff sleep.
    await vi.runAllTimersAsync();
    await pollPromise;

    expect(callCount).toBeGreaterThanOrEqual(2);

    vi.useRealTimers();
  });
});
