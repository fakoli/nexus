/**
 * DiscordAdapter — ChannelAdapter implementation for Discord.
 *
 * Wires together DiscordGateway (inbound) and DiscordRestClient (outbound),
 * parsing raw Discord messages into the normalised InboundMessage shape.
 */
import { createLogger } from "@nexus/core";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelContext,
  SendOptions,
} from "@nexus/channels";
import { DiscordGateway } from "./gateway.js";
import { DiscordRestClient } from "./rest.js";
import type {
  DiscordAdapterConfig,
  DiscordMessage,
  InboundMessage,
} from "./types.js";

const log = createLogger("discord:adapter");

export class DiscordAdapter implements ChannelAdapter {
  // ── ChannelAdapter identity ─────────────────────────────────────────
  readonly id: string;
  readonly name: string;
  readonly capabilities: ChannelCapabilities = {
    dm: true,
    group: true,
    media: false,
    reactions: false,
    markdown: false,
  };

  private gateway: DiscordGateway;
  private rest: DiscordRestClient;
  private readonly config: DiscordAdapterConfig;
  private ctx: ChannelContext | null = null;

  constructor(config: DiscordAdapterConfig, adapterId = "discord") {
    this.config = config;
    this.id = adapterId;
    this.name = "Discord";
    this.gateway = new DiscordGateway(config.token);
    this.rest = new DiscordRestClient(config.token);
  }

  // Exposed for testing — allows injecting mock implementations.
  static create(
    config: DiscordAdapterConfig,
    gateway?: DiscordGateway,
    rest?: DiscordRestClient,
  ): DiscordAdapter {
    const adapter = new DiscordAdapter(config);
    if (gateway) adapter.gateway = gateway;
    if (rest) adapter.rest = rest;
    return adapter;
  }

  // ── ChannelAdapter interface ────────────────────────────────────────

  /**
   * Register an additional raw inbound-message handler (for testing/extension).
   * The primary inbound path goes through ctx.onInbound (the nexus router).
   */
  onMessage(handler: (msg: InboundMessage) => void): void {
    // Keep a per-adapter handler list so callers can register before start().
    this._extraHandlers.push(handler);
  }

  async start(ctx: ChannelContext): Promise<void> {
    log.info("Starting Discord adapter");
    this.ctx = ctx;

    this.gateway.onMessageCreate((raw) => this.handleRawMessage(raw));
    this.gateway.connect();

    log.info("Discord adapter started");
  }

  async stop(): Promise<void> {
    log.info("Stopping Discord adapter");
    this.gateway.disconnect();
    this.ctx = null;
    log.info("Discord adapter stopped");
  }

  async sendReply(target: string, content: string, _options?: SendOptions): Promise<void> {
    await this.rest.sendMessage(target, content);
  }

  private readonly _extraHandlers: Array<(msg: InboundMessage) => void> = [];

  // ── Inbound message processing ──────────────────────────────────────

  private handleRawMessage(raw: DiscordMessage): void {
    // Ignore messages authored by the bot itself.
    const botId = this.gateway.getBotUserId();
    if (botId && raw.author.id === botId) {
      return;
    }

    // Ignore other bots.
    if (raw.author.bot) {
      return;
    }

    // Skip empty messages — nothing useful to route.
    if (!raw.content || raw.content.trim() === "") {
      log.debug({ messageId: raw.id }, "Skipping empty message");
      return;
    }

    // Optional channel filter.
    const allowed = this.config.allowedChannels;
    if (allowed && allowed.length > 0 && !allowed.includes(raw.channel_id)) {
      log.debug({ channelId: raw.channel_id }, "Message ignored: channel not in allowlist");
      return;
    }

    const parsed = this.parseMessage(raw);
    log.debug(
      { messageId: parsed.messageId, authorId: parsed.authorId, isDM: parsed.isDM },
      "Inbound message",
    );

    // Route through the nexus router (primary path).
    if (this.ctx) {
      this.ctx
        .onInbound(parsed.authorId, parsed.content, {
          messageId: parsed.messageId,
          channelId: parsed.channelId,
          guildId: parsed.guildId,
        })
        .catch((err: unknown) => {
          log.error({ err, messageId: parsed.messageId }, "onInbound threw");
        });
    }

    // Also dispatch to any extra registered handlers (e.g. test hooks).
    for (const handler of this._extraHandlers) {
      try {
        handler(parsed);
      } catch (err) {
        log.error({ err }, "Extra message handler threw");
      }
    }
  }

  private parseMessage(raw: DiscordMessage): InboundMessage {
    return {
      messageId: raw.id,
      channelId: raw.channel_id,
      guildId: raw.guild_id,
      authorId: raw.author.id,
      authorName: raw.author.username,
      content: raw.content,
      replyToId: raw.message_reference?.message_id,
      // Discord DMs have no guild_id attached to the message
      isDM: raw.guild_id === undefined,
    };
  }
}
