/**
 * TelegramAdapter — connects the Telegram Bot API to the Nexus channel
 * interface.
 *
 * Lifecycle:
 *   1. Construct with a config (token sourced from config or env var).
 *   2. Call `start(handler)` — begins long-polling; `handler` is invoked
 *      for every normalised InboundMessage.
 *   3. Call `stop()` — signals the poll loop to exit.
 *
 * Outbound:
 *   • `sendReply(chatId, text)` — sends a plain or MarkdownV2 message.
 *   • `sendMedia(chatId, media, mimeType)` — sends a photo or document.
 */

import { createLogger } from "@nexus/core";
import { TelegramBot, TelegramBotError } from "./bot.js";
import type {
  TelegramAdapterConfig,
  TelegramUpdate,
  TelegramMessage,
  InboundMessage,
} from "./types.js";

const log = createLogger("telegram:adapter");

// ── MarkdownV2 escaping ──────────────────────────────────────────────

/**
 * Escapes special characters for Telegram's MarkdownV2 parse mode.
 * Characters that must be escaped: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!\-\\]/g, "\\$&");
}

// ── Message normalisation ────────────────────────────────────────────

/**
 * Converts a raw TelegramMessage into our adapter-level InboundMessage.
 * Returns null if the message has no usable text.
 */
export function normaliseMessage(
  update: TelegramUpdate,
  msg: TelegramMessage,
): InboundMessage | null {
  const text = msg.text ?? msg.caption ?? "";
  // Skip entirely empty messages (e.g. stickers with no caption).
  // Callers can check raw for other content types.
  if (!text && !msg.photo && !msg.document) return null;

  const from = msg.from ?? {
    id: 0,
    is_bot: false,
    first_name: "Unknown",
  };

  const inbound: InboundMessage = {
    chatId: String(msg.chat.id),
    messageId: msg.message_id,
    text,
    from: {
      id: from.id,
      firstName: from.first_name,
      lastName: from.last_name,
      username: from.username,
      isBot: from.is_bot,
    },
    timestamp: new Date(msg.date * 1000).toISOString(),
    raw: update,
  };

  if (msg.reply_to_message) {
    const r = msg.reply_to_message;
    inbound.replyTo = {
      messageId: r.message_id,
      text: r.text ?? r.caption,
      fromId: r.from?.id,
    };
  }

  return inbound;
}

// ── TelegramAdapter ──────────────────────────────────────────────────

export type MessageHandler = (message: InboundMessage) => void | Promise<void>;

export class TelegramAdapter {
  private readonly bot: TelegramBot;
  private readonly config: Required<
    Pick<TelegramAdapterConfig, "pollTimeoutSecs" | "limit" | "allowedUpdates">
  >;
  private handler: MessageHandler | null = null;
  private _running = false;
  private _pollPromise: Promise<void> | null = null;

  constructor(config: TelegramAdapterConfig = {}) {
    const token =
      config.token ?? process.env.TELEGRAM_BOT_TOKEN ?? "";

    if (!token) {
      throw new TelegramBotError(
        "Telegram bot token is required. " +
          "Pass config.token or set TELEGRAM_BOT_TOKEN env var.",
      );
    }

    this.bot = new TelegramBot(token);
    this.config = {
      pollTimeoutSecs: config.pollTimeoutSecs ?? 30,
      limit: config.limit ?? 100,
      allowedUpdates: config.allowedUpdates ?? ["message", "edited_message"],
    };

    log.info("TelegramAdapter initialised");
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Starts the long-polling loop.
   * Resolves once `stop()` is called and the loop exits.
   *
   * @param handler  Called for every inbound message.
   */
  start(handler: MessageHandler): Promise<void> {
    if (this._running) {
      throw new Error("TelegramAdapter is already running");
    }

    this.handler = handler;
    this._running = true;

    log.info("Starting TelegramAdapter");

    this._pollPromise = this.bot.startPolling(
      (update) => this._handleUpdate(update),
      this.config.pollTimeoutSecs,
      this.config.limit,
      this.config.allowedUpdates,
    );

    return this._pollPromise;
  }

  /** Stops the polling loop. Returns when the loop has fully exited. */
  async stop(): Promise<void> {
    if (!this._running) return;
    log.info("Stopping TelegramAdapter");
    this._running = false;
    this.bot.stopPolling();
    if (this._pollPromise) {
      await this._pollPromise;
      this._pollPromise = null;
    }
    this.handler = null;
    log.info("TelegramAdapter stopped");
  }

  get isRunning(): boolean {
    return this._running;
  }

  // ── Update routing ─────────────────────────────────────────────────

  private async _handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message ?? update.edited_message ?? update.channel_post;
    if (!msg) return;

    const inbound = normaliseMessage(update, msg);
    if (!inbound) {
      log.debug({ updateId: update.update_id }, "Skipping non-text update");
      return;
    }

    if (this.handler) {
      try {
        await this.handler(inbound);
      } catch (err) {
        log.error(
          { chatId: inbound.chatId, err: (err as Error).message },
          "Message handler threw",
        );
      }
    }
  }

  // ── Outbound ───────────────────────────────────────────────────────

  /**
   * Sends a text reply to a chat.
   *
   * Uses MarkdownV2 parse mode by default. To send plain text, pass
   * `{ parseMode: undefined }` in options.
   *
   * @param chatId     Target chat ID.
   * @param text       Message text. Special MarkdownV2 chars are auto-escaped
   *                   unless you pass `raw: true`.
   * @param options    Fine-grained send options.
   */
  async sendReply(
    chatId: string | number,
    text: string,
    options: {
      parseMode?: "MarkdownV2" | "HTML" | "Markdown" | null;
      replyToMessageId?: number;
      raw?: boolean;
    } = {},
  ): Promise<TelegramMessage> {
    const parseMode =
      options.parseMode === undefined ? "MarkdownV2" : options.parseMode ?? undefined;

    const safeText =
      parseMode === "MarkdownV2" && !options.raw
        ? escapeMarkdownV2(text)
        : text;

    log.debug({ chatId, parseMode }, "Sending reply");

    return this.bot.sendMessage(chatId, safeText, {
      parse_mode: parseMode ?? undefined,
      reply_to_message_id: options.replyToMessageId,
    });
  }

  /**
   * Sends a binary payload (photo or document) to a chat via the
   * sendPhoto / sendDocument endpoints as a multipart/form-data upload.
   *
   * @param chatId    Target chat ID.
   * @param media     Raw bytes to send.
   * @param mimeType  MIME type — determines which endpoint is used.
   *                  Image types (image/*) → sendPhoto, everything else → sendDocument.
   * @param caption   Optional caption.
   */
  async sendMedia(
    chatId: string | number,
    media: Uint8Array | ArrayBuffer,
    mimeType: string,
    caption?: string,
  ): Promise<TelegramMessage> {
    const isImage = mimeType.startsWith("image/");
    const endpoint = isImage ? "sendPhoto" : "sendDocument";
    const fieldName = isImage ? "photo" : "document";

    const ext = mimeType.split("/")[1] ?? "bin";
    const filename = `upload.${ext}`;

    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append(
      fieldName,
      new Blob([media instanceof ArrayBuffer ? media : (media.buffer as ArrayBuffer).slice(media.byteOffset, media.byteOffset + media.byteLength)], { type: mimeType }),
      filename,
    );
    if (caption) {
      form.append("caption", caption);
      form.append("parse_mode", "MarkdownV2");
    }

    log.debug({ chatId, mimeType, endpoint }, "Sending media");

    const url = this.bot.buildUrl(endpoint);

    let response: Response;
    try {
      response = await fetch(url, { method: "POST", body: form });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TelegramBotError(`Network error calling ${endpoint}: ${msg}`);
    }

    let json: { ok: boolean; result?: TelegramMessage; error_code?: number; description?: string };
    try {
      json = await response.json() as typeof json;
    } catch {
      throw new TelegramBotError(
        `Failed to parse response from ${endpoint} (HTTP ${response.status})`,
      );
    }

    if (!json.ok) {
      throw new TelegramBotError(
        `Telegram API error [${json.error_code}]: ${json.description}`,
        json.error_code,
        json.description,
      );
    }

    if (json.result === undefined) {
      throw new TelegramBotError(`Telegram API returned ok=true but no result for ${endpoint}`);
    }

    return json.result;
  }
}
