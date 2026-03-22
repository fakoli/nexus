/**
 * Unit tests for DiscordAdapter.
 *
 * Gateway and REST dependencies are fully mocked so no network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordAdapter } from "../adapter.js";
import type { DiscordGateway } from "../gateway.js";
import type { DiscordRestClient } from "../rest.js";
import type { DiscordMessage, InboundMessage } from "../types.js";

// ── Factories ─────────────────────────────────────────────────────────

function makeGatewayMock(botUserId = "bot-001"): DiscordGateway {
  return {
    onMessageCreate: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    getBotUserId: vi.fn().mockReturnValue(botUserId),
  } as unknown as DiscordGateway;
}

function makeRestMock(): DiscordRestClient {
  return {
    sendMessage: vi.fn().mockResolvedValue({ id: "sent-msg-id" }),
  } as unknown as DiscordRestClient;
}

function makeRawMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    guild_id: "guild-1",
    author: { id: "user-1", username: "Alice", discriminator: "0001", bot: false },
    content: "Hello!",
    timestamp: "2026-03-22T10:00:00.000Z",
    ...overrides,
  };
}

function buildAdapter(
  allowedChannels?: string[],
  botUserId = "bot-001",
): { adapter: DiscordAdapter; gateway: DiscordGateway; rest: DiscordRestClient } {
  const gateway = makeGatewayMock(botUserId);
  const rest = makeRestMock();
  const adapter = DiscordAdapter.create(
    { token: "test-token", allowedChannels },
    gateway,
    rest,
  );
  return { adapter, gateway, rest };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("DiscordAdapter", () => {
  // ── Lifecycle ──────────────────────────────────────────────────────

  it("start: registers a message handler and connects the gateway", async () => {
    const { adapter, gateway } = buildAdapter();

    await adapter.start({ channelId: "discord", onInbound: async () => {} });

    expect(gateway.onMessageCreate).toHaveBeenCalledOnce();
    expect(gateway.connect).toHaveBeenCalledOnce();
  });

  it("stop: disconnects the gateway", async () => {
    const { adapter, gateway } = buildAdapter();

    await adapter.start({ channelId: "discord", onInbound: async () => {} });
    await adapter.stop();

    expect(gateway.disconnect).toHaveBeenCalledOnce();
  });

  // ── sendReply ──────────────────────────────────────────────────────

  it("sendReply: delegates to REST client with correct args", async () => {
    const { adapter, rest } = buildAdapter();

    await adapter.sendReply("chan-42", "hey there");

    expect(rest.sendMessage).toHaveBeenCalledWith("chan-42", "hey there");
  });

  // ── Message parsing: guild message ──────────────────────────────────

  it("parses a guild message correctly", async () => {
    const { adapter, gateway } = buildAdapter();
    let captured: InboundMessage | undefined;
    adapter.onMessage((m) => { captured = m; });

    await adapter.start({ channelId: "discord", onInbound: async () => {} });

    // Retrieve the handler registered on the gateway mock and invoke it
    const rawHandler = (gateway.onMessageCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      (m: DiscordMessage) => void;

    rawHandler(makeRawMessage({
      id: "msg-42",
      channel_id: "chan-99",
      guild_id: "guild-7",
      author: { id: "user-7", username: "Bob", discriminator: "0002", bot: false },
      content: "what's up",
      message_reference: { message_id: "msg-41" },
    }));

    expect(captured).toBeDefined();
    expect(captured!.messageId).toBe("msg-42");
    expect(captured!.channelId).toBe("chan-99");
    expect(captured!.guildId).toBe("guild-7");
    expect(captured!.authorId).toBe("user-7");
    expect(captured!.authorName).toBe("Bob");
    expect(captured!.content).toBe("what's up");
    expect(captured!.replyToId).toBe("msg-41");
    expect(captured!.isDM).toBe(false);
  });

  // ── Message parsing: DM ──────────────────────────────────────────────

  it("marks messages without guild_id as DMs", async () => {
    const { adapter, gateway } = buildAdapter();
    let captured: InboundMessage | undefined;
    adapter.onMessage((m) => { captured = m; });

    await adapter.start({ channelId: "discord", onInbound: async () => {} });

    const rawHandler = (gateway.onMessageCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      (m: DiscordMessage) => void;

    rawHandler(makeRawMessage({ guild_id: undefined }));

    expect(captured!.isDM).toBe(true);
    expect(captured!.guildId).toBeUndefined();
  });

  // ── Self-message filtering ───────────────────────────────────────────

  it("ignores messages authored by the bot itself", async () => {
    const botId = "bot-001";
    const { adapter, gateway } = buildAdapter(undefined, botId);
    const handler = vi.fn();
    adapter.onMessage(handler);

    await adapter.start({ channelId: "discord", onInbound: async () => {} });

    const rawHandler = (gateway.onMessageCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      (m: DiscordMessage) => void;

    // Message from the bot itself
    rawHandler(makeRawMessage({ author: { id: botId, username: "MyBot", discriminator: "0000", bot: true } }));

    expect(handler).not.toHaveBeenCalled();
  });

  // ── Bot filtering ────────────────────────────────────────────────────

  it("ignores messages from other bots", async () => {
    const { adapter, gateway } = buildAdapter();
    const handler = vi.fn();
    adapter.onMessage(handler);

    await adapter.start({ channelId: "discord", onInbound: async () => {} });

    const rawHandler = (gateway.onMessageCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      (m: DiscordMessage) => void;

    rawHandler(makeRawMessage({ author: { id: "other-bot", username: "SpamBot", discriminator: "9999", bot: true } }));

    expect(handler).not.toHaveBeenCalled();
  });

  // ── Channel allowlist filtering ──────────────────────────────────────

  it("ignores messages from channels not in the allowlist", async () => {
    const { adapter, gateway } = buildAdapter(["chan-allowed"]);
    const handler = vi.fn();
    adapter.onMessage(handler);

    await adapter.start({ channelId: "discord", onInbound: async () => {} });

    const rawHandler = (gateway.onMessageCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      (m: DiscordMessage) => void;

    rawHandler(makeRawMessage({ channel_id: "chan-not-allowed" }));
    expect(handler).not.toHaveBeenCalled();

    rawHandler(makeRawMessage({ channel_id: "chan-allowed" }));
    expect(handler).toHaveBeenCalledOnce();
  });

  // ── Multiple handlers ────────────────────────────────────────────────

  it("dispatches messages to all registered handlers", async () => {
    const { adapter, gateway } = buildAdapter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    adapter.onMessage(h1);
    adapter.onMessage(h2);

    await adapter.start({ channelId: "discord", onInbound: async () => {} });

    const rawHandler = (gateway.onMessageCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      (m: DiscordMessage) => void;

    rawHandler(makeRawMessage());

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  // ── Handler error isolation ───────────────────────────────────────────

  it("continues dispatching if one handler throws", async () => {
    const { adapter, gateway } = buildAdapter();
    const throwing = vi.fn().mockImplementation(() => { throw new Error("boom"); });
    const safe = vi.fn();
    adapter.onMessage(throwing);
    adapter.onMessage(safe);

    await adapter.start({ channelId: "discord", onInbound: async () => {} });

    const rawHandler = (gateway.onMessageCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      (m: DiscordMessage) => void;

    // Should not throw even though the first handler does
    expect(() => rawHandler(makeRawMessage())).not.toThrow();
    expect(safe).toHaveBeenCalledOnce();
  });

  // ── replyToId when no reference ───────────────────────────────────────

  it("sets replyToId to undefined when there is no message_reference", async () => {
    const { adapter, gateway } = buildAdapter();
    let captured: InboundMessage | undefined;
    adapter.onMessage((m) => { captured = m; });

    await adapter.start({ channelId: "discord", onInbound: async () => {} });

    const rawHandler = (gateway.onMessageCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      (m: DiscordMessage) => void;

    rawHandler(makeRawMessage({ message_reference: undefined }));

    expect(captured!.replyToId).toBeUndefined();
  });
});
