/**
 * Lightweight Telegram Bot API client.
 *
 * Uses native `fetch` — no external HTTP dependencies.
 * All methods throw `TelegramBotError` on API-level failures.
 */

import { createLogger } from "@nexus/core";
import type {
  TelegramUser,
  TelegramMessage,
  TelegramUpdate,
  TelegramApiResponse,
  SendMessageOptions,
  EditMessageOptions,
} from "./types.js";

const log = createLogger("telegram:bot");

// ── Error class ──────────────────────────────────────────────────────

export class TelegramBotError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly description?: string,
  ) {
    super(message);
    this.name = "TelegramBotError";
  }
}

// ── Retry / backoff helpers ──────────────────────────────────────────

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
const BACKOFF_MULTIPLIER = 2;

function backoffMs(attempt: number): number {
  const raw = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempt);
  return Math.min(raw, BACKOFF_MAX_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── TelegramBot ──────────────────────────────────────────────────────

export class TelegramBot {
  private readonly baseUrl: string;

  constructor(token: string) {
    if (!token) {
      throw new TelegramBotError("Bot token must not be empty");
    }
    this.baseUrl = `https://api.telegram.org/bot${token}/`;
  }

  /**
   * Returns the fully-qualified URL for a Bot API endpoint.
   * Exposed so that sub-classes and sibling modules (e.g. sendMedia) can
   * construct multipart requests without accessing the private baseUrl field.
   */
  buildUrl(endpoint: string): string {
    return `${this.baseUrl}${endpoint}`;
  }

  // ── Raw request helper ─────────────────────────────────────────────

  private async request<T>(
    method: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${method}`;
    const init: RequestInit = body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { method: "GET" };

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TelegramBotError(`Network error calling ${method}: ${msg}`);
    }

    let json: TelegramApiResponse<T>;
    try {
      json = (await response.json()) as TelegramApiResponse<T>;
    } catch {
      throw new TelegramBotError(
        `Failed to parse Telegram API response for ${method} (HTTP ${response.status})`,
      );
    }

    if (!json.ok) {
      const err = json as { ok: false; error_code: number; description: string };
      throw new TelegramBotError(
        `Telegram API error [${err.error_code}]: ${err.description}`,
        err.error_code,
        err.description,
      );
    }

    return (json as { ok: true; result: T }).result;
  }

  // ── Public API methods ─────────────────────────────────────────────

  /** Returns basic information about the bot. */
  async getMe(): Promise<TelegramUser> {
    return this.request<TelegramUser>("getMe");
  }

  /**
   * Fetches pending updates using long-polling.
   *
   * @param offset  Identifier of the first update to be returned (exclusive
   *                lower bound — pass `lastUpdateId + 1` on subsequent calls).
   * @param timeout Long-poll timeout in seconds.
   * @param limit   Maximum number of updates to return (1–100).
   */
  async getUpdates(
    offset?: number,
    timeout = 30,
    limit = 100,
    allowedUpdates?: string[],
  ): Promise<TelegramUpdate[]> {
    const body: Record<string, unknown> = { timeout, limit };
    if (offset !== undefined) body.offset = offset;
    if (allowedUpdates) body.allowed_updates = allowedUpdates;
    return this.request<TelegramUpdate[]>("getUpdates", body);
  }

  /**
   * Sends a text message to a chat.
   *
   * @param chatId  Target chat ID.
   * @param text    Message text (may use MarkdownV2 if parse_mode is set).
   * @param options Optional send options.
   */
  async sendMessage(
    chatId: number | string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<TelegramMessage> {
    return this.request<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      ...options,
    });
  }

  /**
   * Edits an existing text message.
   *
   * @param chatId    Target chat ID.
   * @param messageId ID of the message to edit.
   * @param text      New message text.
   * @param options   Optional edit options.
   */
  async editMessage(
    chatId: number | string,
    messageId: number,
    text: string,
    options?: EditMessageOptions,
  ): Promise<TelegramMessage | true> {
    return this.request<TelegramMessage | true>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...options,
    });
  }

  // ── Long-polling loop ──────────────────────────────────────────────

  /**
   * Starts a long-polling loop that calls `onUpdate` for each received
   * update. The loop runs until `stopPolling()` is called.
   *
   * Uses exponential back-off on network / API errors so transient
   * failures don't spin-hammer the API.
   *
   * @param onUpdate    Callback invoked for every update.
   * @param timeout     Long-poll timeout in seconds (default: 30).
   * @param limit       Max updates per request (default: 100).
   * @param allowedUpdates  Update types to subscribe to.
   */
  async startPolling(
    onUpdate: (update: TelegramUpdate) => void | Promise<void>,
    timeout = 30,
    limit = 100,
    allowedUpdates?: string[],
  ): Promise<void> {
    this._polling = true;
    let offset: number | undefined;
    let failureCount = 0;

    log.info({ timeout, limit }, "Starting Telegram long-poll loop");

    while (this._polling) {
      try {
        const updates = await this.getUpdates(offset, timeout, limit, allowedUpdates);
        failureCount = 0; // reset on success

        for (const update of updates) {
          if (!this._polling) break;
          try {
            await onUpdate(update);
          } catch (err) {
            log.error(
              { updateId: update.update_id, err: (err as Error).message },
              "Error processing update",
            );
          }
          // Advance offset past this update so it isn't re-delivered.
          offset = update.update_id + 1;
        }
      } catch (err) {
        if (!this._polling) break; // stop() was called — exit cleanly

        failureCount++;
        const wait = backoffMs(failureCount - 1);
        log.warn(
          { attempt: failureCount, waitMs: wait, err: (err as Error).message },
          "Polling error — backing off",
        );
        await sleep(wait);
      }
    }

    log.info("Telegram long-poll loop stopped");
  }

  /** Signals the polling loop to stop after the current request completes. */
  stopPolling(): void {
    this._polling = false;
  }

  /** True while the polling loop is running. */
  get isPolling(): boolean {
    return this._polling;
  }

  private _polling = false;
}
