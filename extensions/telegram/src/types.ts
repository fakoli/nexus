/**
 * Telegram Bot API types — a minimal subset of the official API surface
 * that this adapter actually uses.
 */

// ── Core Telegram objects ────────────────────────────────────────────

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: TelegramUser;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  entities?: TelegramMessageEntity[];
  reply_to_message?: TelegramMessage;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

// ── API response wrappers ────────────────────────────────────────────

export interface TelegramApiOk<T> {
  ok: true;
  result: T;
}

export interface TelegramApiError {
  ok: false;
  error_code: number;
  description: string;
}

export type TelegramApiResponse<T> = TelegramApiOk<T> | TelegramApiError;

// ── sendMessage / editMessageText options ───────────────────────────

export type ParseMode = "MarkdownV2" | "HTML" | "Markdown";

export interface SendMessageOptions {
  parse_mode?: ParseMode;
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
}

export interface EditMessageOptions {
  parse_mode?: ParseMode;
  disable_web_page_preview?: boolean;
}

// ── Adapter-level normalised inbound message ─────────────────────────

export interface InboundMessage {
  /** Telegram chat ID (string for consistent adapter interface). */
  chatId: string;
  /** Telegram numeric message ID within the chat. */
  messageId: number;
  /** Plain text content (text or caption). */
  text: string;
  /** Sender info. */
  from: {
    id: number;
    firstName: string;
    lastName?: string;
    username?: string;
    isBot: boolean;
  };
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** The message being replied to, if any. */
  replyTo?: {
    messageId: number;
    text?: string;
    fromId?: number;
  };
  /** Raw Telegram update for advanced use. */
  raw: TelegramUpdate;
}

// ── Adapter configuration ─────────────────────────────────────────────

export interface TelegramAdapterConfig {
  /** Bot token from BotFather. Falls back to TELEGRAM_BOT_TOKEN env var. */
  token?: string;
  /** Long-poll timeout in seconds (default: 30). */
  pollTimeoutSecs?: number;
  /** Maximum number of updates to fetch per poll request (default: 100). */
  limit?: number;
  /** Allowed update types (default: ["message", "edited_message"]). */
  allowedUpdates?: string[];
}
