/**
 * TelegramChannelStream — feeds Telegram updates into a ChannelStream.
 *
 * Handles message, channel_post, edited_message, and edited_channel_post
 * update types, normalising them into ChannelMessage objects.
 */
import { ChannelStream } from "@nexus/core";
import type { ChannelMessage } from "@nexus/core";
import { createLogger } from "@nexus/core";

const log = createLogger("telegram:stream");

function getString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function getNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === "number" ? v : 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

interface ParsedTelegramMessage {
  messageId: number;
  chatId: string;
  userId: string;
  userName: string;
  content: string;
  timestamp: number;
}

function parseMessage(msg: Record<string, unknown>): ParsedTelegramMessage | null {
  const messageId = getNumber(msg, "message_id");
  const chat = asRecord(msg["chat"]);
  const from = asRecord(msg["from"]);

  if (!chat) {
    log.warn("TelegramChannelStream: missing chat in message");
    return null;
  }

  const chatId = String(getNumber(chat, "id") || getString(chat, "id"));
  const userId = from ? String(getNumber(from, "id") || getString(from, "id")) : "";
  const firstName = from ? getString(from, "first_name") : "";
  const content = getString(msg, "text") || getString(msg, "caption");
  const dateSeconds = getNumber(msg, "date");

  return {
    messageId,
    chatId,
    userId,
    userName: firstName,
    content,
    timestamp: dateSeconds > 0 ? dateSeconds * 1000 : Date.now(),
  };
}

export class TelegramChannelStream {
  private readonly stream: ChannelStream;

  constructor(options?: { maxBufferSize?: number }) {
    this.stream = new ChannelStream(options);
  }

  /**
   * Feed a Telegram update object into the stream.
   * Handled fields: message, channel_post, edited_message, edited_channel_post.
   */
  handleUpdate(update: Record<string, unknown>): void {
    if (update["message"]) {
      const raw = asRecord(update["message"]);
      if (raw) this.processMessage(raw, {});
    } else if (update["channel_post"]) {
      const raw = asRecord(update["channel_post"]);
      if (raw) this.processMessage(raw, {});
    } else if (update["edited_message"]) {
      const raw = asRecord(update["edited_message"]);
      if (raw) this.processMessage(raw, { edited: true });
    } else if (update["edited_channel_post"]) {
      const raw = asRecord(update["edited_channel_post"]);
      if (raw) this.processMessage(raw, { edited: true });
    } else {
      log.debug({ keys: Object.keys(update) }, "TelegramChannelStream: unhandled update type");
    }
  }

  private processMessage(
    msgData: Record<string, unknown>,
    extraMeta: Record<string, unknown>,
  ): void {
    const parsed = parseMessage(msgData);
    if (!parsed) return;

    const meta: Record<string, unknown> | undefined =
      Object.keys(extraMeta).length > 0 ? extraMeta : undefined;

    const msg: ChannelMessage = {
      id: `${parsed.chatId}-${parsed.messageId}`,
      channelId: parsed.chatId,
      platform: "telegram",
      userId: parsed.userId,
      userName: parsed.userName,
      content: parsed.content,
      timestamp: parsed.timestamp,
      metadata: meta,
    };

    this.stream.push(msg);
  }

  getStream(): ChannelStream {
    return this.stream;
  }

  close(): void {
    this.stream.close();
  }
}
