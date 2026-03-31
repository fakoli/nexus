/**
 * DiscordChannelStream — feeds Discord gateway dispatch events into a ChannelStream.
 *
 * Handles MESSAGE_CREATE, MESSAGE_UPDATE, and MESSAGE_DELETE dispatches and
 * normalises them into ChannelMessage objects for downstream consumers.
 */
import { ChannelStream } from "@nexus/core";
import type { ChannelMessage } from "@nexus/core";
import { createLogger } from "@nexus/core";

const log = createLogger("discord:stream");

function extractString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function extractNestedString(
  obj: Record<string, unknown>,
  parent: string,
  key: string,
): string {
  const p = obj[parent];
  if (p !== null && typeof p === "object" && !Array.isArray(p)) {
    const nested = p as Record<string, unknown>;
    const v = nested[key];
    return typeof v === "string" ? v : "";
  }
  return "";
}

function toTimestamp(ts: string): number {
  if (!ts) return Date.now();
  const ms = Date.parse(ts);
  return isNaN(ms) ? Date.now() : ms;
}

export class DiscordChannelStream {
  private readonly stream: ChannelStream;

  constructor(options?: { maxBufferSize?: number }) {
    this.stream = new ChannelStream(options);
  }

  /**
   * Feed a Discord gateway dispatch event into the stream.
   * Handled events: MESSAGE_CREATE, MESSAGE_UPDATE, MESSAGE_DELETE.
   */
  handleDispatch(event: string, data: Record<string, unknown>): void {
    switch (event) {
      case "MESSAGE_CREATE":
        this.handleCreate(data, {});
        break;
      case "MESSAGE_UPDATE":
        this.handleCreate(data, { update: true });
        break;
      case "MESSAGE_DELETE":
        this.handleDelete(data);
        break;
      default:
        log.debug({ event }, "DiscordChannelStream: unhandled dispatch event");
    }
  }

  private handleCreate(
    data: Record<string, unknown>,
    extraMeta: Record<string, unknown>,
  ): void {
    const id = extractString(data, "id");
    const channelId = extractString(data, "channel_id");
    const userId = extractNestedString(data, "author", "id");
    const userName = extractNestedString(data, "author", "username");
    const content = extractString(data, "content");
    const rawTs = extractString(data, "timestamp");

    if (!id || !channelId) {
      log.warn({ data }, "DiscordChannelStream: missing id or channel_id in MESSAGE dispatch");
      return;
    }

    const msg: ChannelMessage = {
      id,
      channelId,
      platform: "discord",
      userId,
      userName,
      content,
      timestamp: toTimestamp(rawTs),
      metadata: Object.keys(extraMeta).length > 0 ? extraMeta : undefined,
    };

    this.stream.push(msg);
  }

  private handleDelete(data: Record<string, unknown>): void {
    const id = extractString(data, "id");
    const channelId = extractString(data, "channel_id");

    if (!id || !channelId) {
      log.warn({ data }, "DiscordChannelStream: missing id or channel_id in MESSAGE_DELETE");
      return;
    }

    const msg: ChannelMessage = {
      id,
      channelId,
      platform: "discord",
      userId: "",
      userName: "",
      content: "",
      timestamp: Date.now(),
      metadata: { deleted: true },
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
