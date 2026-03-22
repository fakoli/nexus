/**
 * Outbound reply formatting and dispatch.
 *
 * Wraps the raw adapter.sendReply() call with:
 *   - Content length truncation (platform limits vary)
 *   - Basic markdown stripping for channels that don't support it
 *   - Audit logging of outbound messages
 *   - Error recovery (logs and swallows send errors so a failed reply
 *     doesn't crash the router)
 */

import { createLogger, recordAudit } from "@nexus/core";
import type { ChannelAdapter, SendOptions } from "./adapter.js";

const log = createLogger("channels:reply");

/** Default max characters before truncation. Adapters can override via options. */
const DEFAULT_MAX_LENGTH = 4096;

/**
 * Strip common markdown syntax to produce plain text.
 * Used for channels that set capabilities.markdown = false.
 */
export function stripMarkdown(text: string): string {
  return text
    // Headers
    .replace(/^#{1,6}\s+/gm, "")
    // Bold / italic
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    // Inline code
    .replace(/`([^`]+)`/g, "$1")
    // Code blocks
    .replace(/```[\s\S]*?```/g, (match) => {
      const lines = match.split("\n").slice(1, -1);
      return lines.join("\n");
    })
    // Links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, "")
    // Blockquotes
    .replace(/^>\s+/gm, "")
    .trim();
}

/**
 * Truncate content to maxLength characters, appending a notice if clipped.
 */
export function truncateContent(content: string, maxLength = DEFAULT_MAX_LENGTH): string {
  if (content.length <= maxLength) return content;
  const notice = "\n…(truncated)";
  return content.slice(0, maxLength - notice.length) + notice;
}

/**
 * Format content for a given adapter before sending.
 *
 * @param adapter  - Target channel adapter.
 * @param content  - Raw reply text (may contain markdown).
 * @param options  - Caller-provided send options.
 */
export function formatReply(
  adapter: ChannelAdapter,
  content: string,
  options?: SendOptions,
): string {
  let formatted = content;

  // Strip markdown for channels that don't support it (unless the caller has
  // explicitly overridden via options.markdown).  The adapter's capabilities
  // flag is the canonical source of truth; the caller-supplied option can
  // force markdown on (true) or off (false) regardless of capability.
  const wantsMarkdown = options?.markdown ?? adapter.capabilities.markdown;
  if (!wantsMarkdown) {
    formatted = stripMarkdown(formatted);
  }

  return truncateContent(formatted);
}

/**
 * Dispatch a formatted reply through the adapter, with error isolation and
 * audit logging.
 *
 * @param adapter   - The channel adapter to send via.
 * @param target    - Platform-specific target id (user/chat/phone number).
 * @param content   - The reply content (will be formatted).
 * @param channelId - Channel id used for audit logging.
 * @param options   - Optional send options forwarded to the adapter.
 */
export async function dispatchReply(
  adapter: ChannelAdapter,
  target: string,
  content: string,
  channelId: string,
  options?: SendOptions,
): Promise<void> {
  const formatted = formatReply(adapter, content, options);

  log.debug({ channelId, target, length: formatted.length }, "Dispatching reply");

  try {
    await adapter.sendReply(target, formatted, options);
    recordAudit("channel_reply_sent", channelId, { target, length: formatted.length });
    log.info({ channelId, target }, "Reply sent");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ channelId, target, error: msg }, "Failed to send reply");
    recordAudit("channel_reply_failed", channelId, { target, error: msg });
    // Intentionally not re-throwing — a failed reply must not crash the router
  }
}
