/**
 * TelegramAdapter — connects the Telegram Bot API to the Nexus channel
 * interface.
 *
 * Lifecycle:
 *   1. Construct with a config (token sourced from config or env var).
 *   2. Call `start(ctx)` — begins long-polling; ctx.onInbound() is invoked
 *      for every normalised InboundMessage.
 *   3. Call `stop()` — signals the poll loop to exit.
 *
 * Outbound:
 *   • `sendReply(chatId, text)` — sends a plain or MarkdownV2 message.
 *   • `sendMedia(chatId, media, mimeType)` — sends a photo or document.
 */

import { createLogger } from "@nexus/core";
import type { ChannelAdapter, ChannelCapabilities, ChannelContext, SendOptions } from "@nexus/channels";
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

export class TelegramAdapter implements ChannelAdapter {
  // ── ChannelAdapter identity ──────────────────────────────────────────
  readonly id: string;
  readonly name = "Telegram";
  readonly capabilities: ChannelCapabilities = {
    dm: true,
    group: true,
    media: true,
    reactions: false,
    markdown: true,
  };

  private readonly bot: TelegramBot;
  private readonly config: Required<
    Pick<TelegramAdapterConfig, "pollTimeoutSecs" | "limit" | "allowedUpdates">
  >;
  private ctx: ChannelContext | null = null;
  private _running = false;
  private _pollPromise: Promise<void> | null = null;

  constructor(config: TelegramAdapterConfig = {}, adapterId = "telegram") {
    const token =
      config.token ?? process.env.TELEGRAM_BOT_TOKEN ?? "";

    if (!token) {
      throw new TelegramBotError(
        "Telegram bot token is required. " +
          "Pass config.token or set TELEGRAM_BOT_TOKEN env var.",
      );
    }

    this.id = adapterId;
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
   * Accepts a ChannelContext whose onInbound callback is called for every
   * inbound message, routing it through the Nexus channel router.
   */
  async start(ctx: ChannelContext): Promise<void> {
    if (this._running) {
      throw new Error("TelegramAdapter is already running");
    }

    this.ctx = ctx;
    this._running = true;

    log.info("Starting TelegramAdapter");

    // Fire-and-forget the poll loop — it runs until stop() is called.
    this._pollPromise = this.bot.startPolling(
      (update) => this._handleUpdate(update),
      this.config.pollTimeoutSecs,
      this.config.limit,
      this.config.allowedUpdates,
    );

    // Don't await the poll loop here; it runs in the background.
    this._pollPromise.catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, "Poll loop exited with error");
    });
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
    this.ctx = null;
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

    if (this.ctx) {
      try {
        await this.ctx.onInbound(inbound.chatId, inbound.text, {
          messageId: inbound.messageId,
          fromId: inbound.from.id,
          fromUsername: inbound.from.username,
          timestamp: inbound.timestamp,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error({ chatId: inbound.chatId, err: errMsg }, "onInbound threw");
      }
    }
  }

  // ── Outbound ───────────────────────────────────────────────────────

  /**
   * Sends a text reply to a chat (implements ChannelAdapter.sendReply).
   *
   * Uses MarkdownV2 parse mode by default when options.markdown is true.
   * Special MarkdownV2 chars are auto-escaped unless options.raw is set.
   *
   * @param target   Target chat ID (string form).
   * @param content  Message text.
   * @param options  SendOptions (replyToMessageId, markdown, raw, etc.).
   */
  async sendReply(
    target: string,
    content: string,
    options: SendOptions & { raw?: boolean; replyToMessageId?: string } = {},
  ): Promise<void> {
    const useMarkdown = options.markdown !== false;
    const parseMode: "MarkdownV2" | undefined = useMarkdown ? "MarkdownV2" : undefined;

    const safeText =
      parseMode === "MarkdownV2" && !options.raw
        ? escapeMarkdownV2(content)
        : content;

    const replyId = options.replyToMessageId
      ? parseInt(options.replyToMessageId, 10)
      : undefined;

    log.debug({ chatId: target, parseMode }, "Sending reply");

    await this.bot.sendMessage(target, safeText, {
      parse_mode: parseMode,
      reply_to_message_id: Number.isNaN(replyId) ? undefined : replyId,
    });
  }

  /**
   * Sends a binary payload (photo or document) to a chat via the
   * sendPhoto / sendDocument endpoints as a multipart/form-data upload.
   * Implements the optional ChannelAdapter.sendMedia interface.
   *
   * @param target    Target chat ID (string).
   * @param media     Raw bytes to send.
   * @param mimeType  MIME type — determines which endpoint is used.
   *                  Image types (image/*) → sendPhoto, everything else → sendDocument.
   */
  async sendMedia(
    target: string,
    media: Buffer,
    mimeType: string,
  ): Promise<void> {
    await this._sendMediaInternal(target, media, mimeType);
  }

  private async _sendMediaInternal(
    chatId: string,
    media: Uint8Array | ArrayBuffer | Buffer,
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
