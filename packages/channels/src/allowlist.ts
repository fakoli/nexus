/**
 * Allowlist enforcement.
 *
 * Rules are stored in the core SQLite `allowlist` table:
 *   channel TEXT | NULL — NULL means "applies to all channels"
 *   pattern TEXT        — glob-style pattern matched against senderId
 *   policy  TEXT        — "allow" | "deny"
 *
 * Decision algorithm:
 *   1. Collect all rules where channel = given channelId OR channel IS NULL.
 *   2. If no rules exist → allow (open-by-default when no policy is configured).
 *   3. Evaluate rules in insertion order; stop at first matching rule.
 *   4. If no rule matches → deny (deny-by-default when rules exist).
 */

import { getDb, createLogger } from "@nexus/core";

const log = createLogger("channels:allowlist");

export interface AllowlistResult {
  allowed: boolean;
  reason: string;
}

interface AllowlistRow {
  id: number;
  channel: string | null;
  pattern: string;
  policy: string;
}

/**
 * Convert a simple glob pattern (supporting `*` and `?`) to a RegExp.
 * Only `*` (any sequence) and `?` (single char) wildcards are supported.
 */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex metacharacters
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * Check whether `senderId` is allowed to interact on `channelId`.
 *
 * @param channelId - The channel the message arrived on.
 * @param senderId  - Platform-specific sender identifier.
 */
export function checkAllowlist(channelId: string, senderId: string): AllowlistResult {
  const db = getDb();

  // Load per-channel rules first, then global rules; preserve insertion order.
  const rows = db
    .prepare(
      `SELECT id, channel, pattern, policy
       FROM allowlist
       WHERE channel = ? OR channel IS NULL
       ORDER BY id ASC`,
    )
    .all(channelId) as AllowlistRow[];

  if (rows.length === 0) {
    // No rules at all — open system
    return { allowed: true, reason: "no rules configured" };
  }

  // Per-channel rules take precedence: evaluate channel-specific ones first,
  // then fall through to global rules.
  const channelRules = rows.filter((r) => r.channel === channelId);
  const globalRules = rows.filter((r) => r.channel === null);
  const ordered = [...channelRules, ...globalRules];

  for (const rule of ordered) {
    const regex = patternToRegex(rule.pattern);
    if (regex.test(senderId)) {
      const allowed = rule.policy === "allow";
      log.debug(
        { channelId, senderId, ruleId: rule.id, pattern: rule.pattern, policy: rule.policy },
        "Allowlist rule matched",
      );
      return {
        allowed,
        reason: allowed
          ? `matched allow rule #${rule.id} (pattern: ${rule.pattern})`
          : `matched deny rule #${rule.id} (pattern: ${rule.pattern})`,
      };
    }
  }

  // Rules exist but none matched → deny by default
  return { allowed: false, reason: "no matching rule; deny by default" };
}

/**
 * Add an explicit allow entry for a sender on a specific channel.
 * Used by the pairing flow after a code is approved.
 */
export function addAllowlistEntry(
  channelId: string | null,
  pattern: string,
  policy: "allow" | "deny" = "allow",
): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO allowlist (channel, pattern, policy) VALUES (?, ?, ?)",
  ).run(channelId, pattern, policy);
  log.info({ channelId, pattern, policy }, "Allowlist entry added");
}

/**
 * Remove an allowlist entry by its id.
 */
export function removeAllowlistEntry(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM allowlist WHERE id = ?").run(id);
  log.info({ id }, "Allowlist entry removed");
}

/**
 * List all allowlist entries, optionally filtered by channel.
 */
export function listAllowlistEntries(channelId?: string): AllowlistRow[] {
  const db = getDb();
  if (channelId !== undefined) {
    return db
      .prepare("SELECT id, channel, pattern, policy FROM allowlist WHERE channel = ? ORDER BY id ASC")
      .all(channelId) as AllowlistRow[];
  }
  return db
    .prepare("SELECT id, channel, pattern, policy FROM allowlist ORDER BY id ASC")
    .all() as AllowlistRow[];
}
