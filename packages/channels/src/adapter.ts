/**
 * ChannelAdapter — the interface every channel driver must implement.
 *
 * Keeps concerns tight: lifecycle, outbound dispatch, and a small set of
 * optional capabilities.  Inbound messages arrive via the adapter calling
 * router.routeInbound(); the adapter is responsible for wiring its own
 * platform-specific listener.
 */

export interface ChannelCapabilities {
  /** Can send and receive 1-to-1 direct messages. */
  dm: boolean;
  /** Can participate in group chats / channels. */
  group: boolean;
  /** Can send binary media (images, audio, files). */
  media: boolean;
  /** Can add emoji reactions to messages. */
  reactions: boolean;
  /** Supports markdown formatting in outbound messages. */
  markdown: boolean;
}

/**
 * Startup context injected by the registry into every adapter.
 * Adapters may store this reference for later use.
 */
export interface ChannelContext {
  /** The channel id assigned at registration time (matches ChannelAdapter.id). */
  channelId: string;
  /**
   * Callback the adapter MUST invoke for every inbound message it receives.
   * The router handles allowlist checks, pairing challenges, session lookup,
   * and dispatching to the agent.
   */
  onInbound: (
    senderId: string,
    message: string,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
}

export interface SendOptions {
  /** Reply to a specific message thread (platform-dependent). */
  replyToMessageId?: string;
  /** Whether the content should be parsed as markdown. */
  markdown?: boolean;
  /** Additional platform-specific options. */
  [key: string]: unknown;
}

export interface ChannelAdapter {
  /** Unique identifier for this adapter instance, e.g. "whatsapp", "slack". */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Feature flags for this channel. */
  readonly capabilities: ChannelCapabilities;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Called by the registry to start the adapter.
   * The adapter should begin listening for inbound messages and call
   * ctx.onInbound() for each one.
   */
  start(ctx: ChannelContext): Promise<void>;

  /** Called by the registry to perform a clean shutdown. */
  stop(): Promise<void>;

  // ── Outbound ───────────────────────────────────────────────────────────────

  /**
   * Send a text reply to a target (user id, chat id, phone number, etc.).
   * The format of `target` is adapter-specific.
   */
  sendReply(target: string, content: string, options?: SendOptions): Promise<void>;

  // ── Optional capabilities ──────────────────────────────────────────────────

  /** Send binary media. Only available when capabilities.media is true. */
  sendMedia?(target: string, media: Buffer, mimeType: string): Promise<void>;

  /** Edit a previously sent message by its platform message id. */
  editMessage?(messageId: string, content: string): Promise<void>;

  /** Delete a previously sent message by its platform message id. */
  deleteMessage?(messageId: string): Promise<void>;
}
