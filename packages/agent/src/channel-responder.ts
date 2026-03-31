/**
 * ChannelResponder — consumes a ChannelStream and responds to messages
 * based on the configured observation mode and cooldown.
 */
import type { ChannelStream, ChannelMessage, ChannelObservation } from "@nexus/core";
import { createLogger } from "@nexus/core";

const log = createLogger("agent:channel-responder");

export interface ChannelResponderStats {
  received: number;
  responded: number;
  skipped: number;
}

export interface ChannelResponderOptions {
  stream: ChannelStream;
  config: ChannelObservation;
  onRespond: (message: ChannelMessage, response: string) => Promise<void>;
  agentId?: string;
  sessionId?: string;
  /** Bot's own user ID — messages from this user are skipped. */
  botUserId?: string;
  /** Name/ID the bot listens for in "mention-only" mode. */
  botName?: string;
}

export class ChannelResponder {
  private readonly stream: ChannelStream;
  private readonly config: ChannelObservation;
  private readonly onRespond: (message: ChannelMessage, response: string) => Promise<void>;
  private readonly agentId: string;
  private readonly sessionId: string;
  private readonly botUserId: string;
  private readonly botName: string;

  private stopped = false;
  private lastRespondedAt = 0;
  private _stats: ChannelResponderStats = { received: 0, responded: 0, skipped: 0 };

  constructor(options: ChannelResponderOptions) {
    this.stream = options.stream;
    this.config = options.config;
    this.onRespond = options.onRespond;
    this.agentId = options.agentId ?? "default";
    this.sessionId = options.sessionId ?? "";
    this.botUserId = options.botUserId ?? "";
    this.botName = options.botName ?? "";
  }

  get stats(): ChannelResponderStats {
    return { ...this._stats };
  }

  /** Stop consuming the stream. */
  stop(): void {
    this.stopped = true;
  }

  /**
   * Start consuming messages from the stream.
   * Resolves when the stream closes or stop() is called.
   */
  async start(): Promise<void> {
    log.info(
      { agentId: this.agentId, mode: this.config.mode },
      "ChannelResponder starting",
    );

    for await (const msg of this.stream) {
      if (this.stopped) break;
      await this.handleMessage(msg);
    }

    log.info({ stats: this._stats }, "ChannelResponder finished");
  }

  private async handleMessage(msg: ChannelMessage): Promise<void> {
    this._stats.received++;

    const mode = this.config.mode;

    // Mode "off" — ignore everything
    if (mode === "off") {
      this._stats.skipped++;
      return;
    }

    // Skip messages from the bot itself
    if (this.botUserId && msg.userId === this.botUserId) {
      this._stats.skipped++;
      log.debug({ id: msg.id }, "Skipping own-bot message");
      return;
    }

    // Mode "observe" — never respond
    if (mode === "observe") {
      log.debug({ id: msg.id }, "Observe mode — not responding");
      this._stats.skipped++;
      return;
    }

    // Check if this message should trigger a response
    if (!this.shouldRespond(msg)) {
      this._stats.skipped++;
      return;
    }

    // Cooldown check
    const now = Date.now();
    if (now - this.lastRespondedAt < this.config.cooldownMs) {
      log.debug(
        { id: msg.id, cooldownMs: this.config.cooldownMs },
        "Skipping message — in cooldown",
      );
      this._stats.skipped++;
      return;
    }

    this.lastRespondedAt = now;

    try {
      // The response text in this abstract layer is a placeholder; the caller
      // provides the actual onRespond callback which calls the agent.
      await this.onRespond(msg, msg.content);
      this._stats.responded++;
      log.info({ id: msg.id, agentId: this.agentId }, "Responded to message");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ id: msg.id, err: errMsg }, "Error responding to message");
      this._stats.skipped++;
    }
  }

  private shouldRespond(msg: ChannelMessage): boolean {
    const mode = this.config.mode;

    if (mode === "active") {
      return true;
    }

    if (mode === "mention-only") {
      const name = this.botName.toLowerCase();
      if (!name) {
        // No bot name configured — respond to nothing in mention-only mode
        return false;
      }
      return msg.content.toLowerCase().includes(name);
    }

    return false;
  }
}
