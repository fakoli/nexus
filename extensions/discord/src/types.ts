/**
 * Discord-specific types covering the Gateway and REST APIs (v10).
 */

// ── Gateway opcodes ──────────────────────────────────────────────────

export const GatewayOp = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const;

export type GatewayOpCode = (typeof GatewayOp)[keyof typeof GatewayOp];

// ── Gateway intent bit-flags ─────────────────────────────────────────

export const GatewayIntent = {
  Guilds: 1 << 0,
  GuildMessages: 1 << 9,
  MessageContent: 1 << 15,
  DirectMessages: 1 << 12,
} as const;

// ── Raw gateway payloads ─────────────────────────────────────────────

export interface GatewayPayload {
  op: GatewayOpCode;
  d: unknown;
  s: number | null;
  t: string | null;
}

export interface HelloData {
  heartbeat_interval: number;
}

export interface ReadyData {
  v: number;
  user: DiscordUser;
  session_id: string;
  resume_gateway_url: string;
}

// ── Discord domain objects ───────────────────────────────────────────

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  bot?: boolean;
}

export interface DiscordMessageReference {
  message_id?: string;
  channel_id?: string;
  guild_id?: string;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  message_reference?: DiscordMessageReference;
  referenced_message?: DiscordMessage;
}

// ── Adapter-level parsed message ────────────────────────────────────

export interface InboundMessage {
  /** Unique Discord message snowflake. */
  messageId: string;
  /** Channel the message was posted in. */
  channelId: string;
  /** Guild (server) ID, undefined for DMs. */
  guildId: string | undefined;
  /** Author's user ID. */
  authorId: string;
  /** Author's username. */
  authorName: string;
  /** Plain-text message content. */
  content: string;
  /** Snowflake of the message being replied to, if any. */
  replyToId: string | undefined;
  /** True when the message originates from a DM channel. */
  isDM: boolean;
}

// ── Adapter config ──────────────────────────────────────────────────

export interface DiscordAdapterConfig {
  /** Discord bot token. */
  token: string;
  /** Only process messages from these channel IDs (empty = all). */
  allowedChannels?: string[];
}

// NOTE: DiscordAdapter implements the canonical ChannelAdapter from
// @nexus/channels.  The interface is NOT re-declared here to avoid
// drift; import it directly from "@nexus/channels" when needed.
