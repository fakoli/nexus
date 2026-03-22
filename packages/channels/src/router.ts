/**
 * Inbound message router.
 *
 * For every inbound message:
 *   1. Lookup the channel adapter in the registry.
 *   2. Check the allowlist — reject or pass.
 *   3. For "pairing" policy channels, trigger a pairing challenge for unknown senders.
 *   4. Derive agentId + sessionId from the routing key.
 *   5. Call runAgent() and dispatch the reply back through the adapter.
 */

import { createLogger, recordAudit, getConfig } from "@nexus/core";
import { runAgent } from "@nexus/agent";
import { checkAllowlist } from "./allowlist.js";
import { createPairingChallenge } from "./pairing.js";
import { getAdapter } from "./registry.js";
import { dispatchReply } from "./reply.js";

const log = createLogger("channels:router");

/**
 * Inbound routing policy for a channel.
 *
 * - "open"    — no allowlist check (everyone is allowed).
 * - "strict"  — deny if not on the allowlist; no pairing offered.
 * - "pairing" — deny unknown senders but send them a pairing challenge.
 */
export type RoutingPolicy = "open" | "strict" | "pairing";

/**
 * Per-channel routing configuration.
 * Stored in the core config under key `channels.<channelId>.routing`.
 */
export interface ChannelRoutingConfig {
  /** Default agent to route messages to (defaults to "default"). */
  agentId?: string;
  /** What to do with senders not on the allowlist. */
  policy?: RoutingPolicy;
  /** System prompt override for agent runs from this channel. */
  systemPrompt?: string;
}

export interface RouteResult {
  agentId: string;
  sessionId: string;
  reply: string;
}

/**
 * Build the canonical session key for a (channel, sender, agent) triple.
 * Sessions are persistent per sender per agent per channel.
 */
export function buildSessionKey(channelId: string, senderId: string, agentId: string): string {
  return `${channelId}:${senderId}:${agentId}`;
}

/**
 * Retrieve routing configuration for a channel from core config.
 * Falls back to sensible defaults if not configured.
 */
function getChannelConfig(channelId: string): ChannelRoutingConfig {
  try {
    const raw = getConfig(`channels.${channelId}.routing`);
    if (raw && typeof raw === "object") return raw as ChannelRoutingConfig;
  } catch {
    // key not found — use defaults
  }
  return {};
}

/**
 * Route an inbound message from a channel sender to the appropriate agent session.
 *
 * Called by each adapter's ChannelContext.onInbound callback.
 *
 * @param channelId - The channel the message arrived on.
 * @param senderId  - Platform-specific sender identifier.
 * @param message   - The raw message text.
 * @param metadata  - Optional platform metadata (message id, timestamps, etc.).
 */
export async function routeInbound(
  channelId: string,
  senderId: string,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // Guard against empty or whitespace-only messages before any processing.
  if (!message || message.trim() === "") {
    log.debug({ channelId, senderId }, "Dropping empty inbound message");
    return;
  }

  log.info({ channelId, senderId }, "Inbound message received");
  recordAudit("channel_message_inbound", senderId, { channelId, hasMetadata: !!metadata });

  const adapter = getAdapter(channelId);
  if (!adapter) {
    log.error({ channelId }, "No adapter found for channel — dropping message");
    return;
  }

  const config = getChannelConfig(channelId);
  const policy: RoutingPolicy = config.policy ?? "strict";
  const agentId = config.agentId ?? "default";

  // ── Allowlist check ────────────────────────────────────────────────────────

  if (policy !== "open") {
    const check = checkAllowlist(channelId, senderId);

    if (!check.allowed) {
      log.warn({ channelId, senderId, reason: check.reason }, "Sender not allowed");
      recordAudit("channel_message_denied", senderId, { channelId, reason: check.reason });

      if (policy === "pairing") {
        // Trigger a pairing challenge
        try {
          const code = createPairingChallenge(channelId, senderId);
          const challengeMsg =
            `You are not yet authorised to use this assistant.\n` +
            `Share the following code with the administrator to request access:\n\n` +
            `  ${code}\n\n` +
            `This code expires in 1 hour.`;
          await dispatchReply(adapter, senderId, challengeMsg, channelId);
          log.info({ channelId, senderId }, "Pairing challenge sent");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ channelId, senderId, error: msg }, "Could not create pairing challenge");
          await dispatchReply(
            adapter,
            senderId,
            "Access denied. Please contact the administrator.",
            channelId,
          );
        }
      } else {
        // strict — silent deny with a polite message
        await dispatchReply(
          adapter,
          senderId,
          "Access denied.",
          channelId,
        );
      }
      return;
    }
  }

  // ── Route to agent ────────────────────────────────────────────────────────

  const sessionId = buildSessionKey(channelId, senderId, agentId);
  log.info({ channelId, senderId, agentId, sessionId }, "Routing to agent");

  try {
    const result = await runAgent({
      sessionId,
      agentId,
      userMessage: message,
      systemPrompt: config.systemPrompt,
      onText: (text: string) => log.debug({ channelId, chunk: text.length }, "Agent streaming chunk"),
    });

    await dispatchReply(adapter, senderId, result.content, channelId, {
      replyToMessageId: metadata?.messageId as string | undefined,
    });

    log.info(
      { channelId, senderId, sessionId, tokens: result.usage },
      "Message routed successfully",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ channelId, senderId, sessionId, error: msg }, "Agent run failed");
    recordAudit("channel_agent_error", senderId, { channelId, sessionId, error: msg });
    await dispatchReply(
      adapter,
      senderId,
      "Sorry, I encountered an error processing your message. Please try again.",
      channelId,
    );
  }
}
