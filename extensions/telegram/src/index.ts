/**
 * @nexus/telegram — Telegram Bot API channel adapter.
 *
 * Usage:
 *   import { TelegramAdapter } from "@nexus/telegram";
 *
 *   const adapter = new TelegramAdapter({ token: process.env.TELEGRAM_BOT_TOKEN });
 *   await adapter.start(async (msg) => {
 *     await adapter.sendReply(msg.chatId, `Echo: ${msg.text}`);
 *   });
 */

export { TelegramAdapter } from "./adapter.js";
export type { MessageHandler } from "./adapter.js";
export { escapeMarkdownV2, normaliseMessage } from "./adapter.js";

export { TelegramBot, TelegramBotError } from "./bot.js";

export type {
  TelegramUser,
  TelegramChat,
  TelegramMessage,
  TelegramUpdate,
  TelegramMessageEntity,
  TelegramPhotoSize,
  TelegramDocument,
  TelegramApiResponse,
  TelegramApiOk,
  TelegramApiError,
  ParseMode,
  SendMessageOptions,
  EditMessageOptions,
  InboundMessage,
  TelegramAdapterConfig,
} from "./types.js";
