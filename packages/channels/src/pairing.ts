/**
 * DM pairing — protects channels that require explicit sender approval.
 *
 * Flow:
 *   1. Unknown sender messages an allowlist-protected channel.
 *   2. Router calls createPairingChallenge(channel, senderId).
 *      → An 8-char alphanumeric code is generated and stored with a 1-hour TTL.
 *      → The code is returned to the router, which asks the adapter to DM it
 *        back to the sender ("Reply with code XXXXXXXX to gain access").
 *   3. The human owner types /pair XXXXXXXX (or whatever the CLI exposes).
 *      → approvePairing(channel, code) is called.
 *      → Sender is added to the allowlist and the pending request is deleted.
 *
 * Storage: a `pairing_requests` table added via migration version 2.
 */

import { getDb, createLogger, recordAudit } from "@nexus/core";
import { addAllowlistEntry } from "./allowlist.js";

const log = createLogger("channels:pairing");

/** Characters used for code generation — excludes visually ambiguous chars (0 O I l 1). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const TTL_SECONDS = 60 * 60; // 1 hour
const MAX_PENDING_PER_SENDER = 3;

export interface PairingRequest {
  id: number;
  channelId: string;
  senderId: string;
  code: string;
  expiresAt: number;
  createdAt: number;
}

// ── Migration helper ─────────────────────────────────────────────────────────

/**
 * Ensure the `pairing_requests` table exists.
 * Called lazily on first use so that the channels package can be imported
 * without running the full core migration chain.
 */
export function ensurePairingTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS pairing_requests (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT    NOT NULL,
      sender_id  TEXT    NOT NULL,
      code       TEXT    NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_pairing_code    ON pairing_requests(code);
    CREATE INDEX IF NOT EXISTS idx_pairing_sender  ON pairing_requests(channel_id, sender_id);
  `);
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function generateCode(): string {
  let code = "";
  const buf = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(buf);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  }
  return code;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function purgeExpired(): void {
  const db = getDb();
  db.prepare("DELETE FROM pairing_requests WHERE expires_at <= ?").run(nowSeconds());
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a pairing challenge for an unknown sender.
 *
 * Returns the code the operator should forward to the sender.
 * Throws if the sender already has MAX_PENDING_PER_SENDER active requests.
 */
export function createPairingChallenge(channelId: string, senderId: string): string {
  ensurePairingTable();
  purgeExpired();

  const db = getDb();
  const now = nowSeconds();

  // Check how many active (non-expired) requests this sender already has
  const pending = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM pairing_requests WHERE channel_id = ? AND sender_id = ? AND expires_at > ?",
    )
    .get(channelId, senderId, now) as { cnt: number };

  if (pending.cnt >= MAX_PENDING_PER_SENDER) {
    throw new Error(
      `Sender '${senderId}' on channel '${channelId}' already has ${MAX_PENDING_PER_SENDER} pending pairing requests`,
    );
  }

  // Generate a collision-free code (retry on the rare collision)
  let code: string;
  let attempts = 0;
  while (true) {
    code = generateCode();
    const existing = db
      .prepare("SELECT id FROM pairing_requests WHERE code = ?")
      .get(code);
    if (!existing) break;
    if (++attempts > 10) throw new Error("Failed to generate unique pairing code after 10 attempts");
  }

  const expiresAt = now + TTL_SECONDS;
  db.prepare(
    "INSERT INTO pairing_requests (channel_id, sender_id, code, expires_at) VALUES (?, ?, ?, ?)",
  ).run(channelId, senderId, code, expiresAt);

  log.info({ channelId, senderId, expiresAt }, "Pairing challenge created");
  recordAudit("channel_pairing_challenge", senderId, { channelId });

  return code;
}

/**
 * Approve a pairing request by code.
 *
 * On success: adds the sender to the allowlist and deletes the request.
 * Returns the approved senderId so the caller can confirm to the operator.
 * Throws if the code is unknown or expired.
 */
export function approvePairing(channelId: string, code: string): string {
  ensurePairingTable();
  purgeExpired();

  const db = getDb();
  const now = nowSeconds();
  const normalizedCode = code.toUpperCase().trim();

  const row = db
    .prepare(
      `SELECT id, channel_id as channelId, sender_id as senderId, code, expires_at as expiresAt, created_at as createdAt
       FROM pairing_requests
       WHERE code = ? AND channel_id = ? AND expires_at > ?`,
    )
    .get(normalizedCode, channelId, now) as PairingRequest | undefined;

  if (!row) {
    throw new Error(`Pairing code '${normalizedCode}' not found or expired for channel '${channelId}'`);
  }

  // Add to allowlist and clean up
  db.transaction(() => {
    addAllowlistEntry(channelId, row.senderId, "allow");
    db.prepare("DELETE FROM pairing_requests WHERE id = ?").run(row.id);
  })();

  log.info({ channelId, senderId: row.senderId }, "Pairing approved — sender added to allowlist");
  recordAudit("channel_pairing_approved", "operator", { channelId, senderId: row.senderId });

  return row.senderId;
}

/**
 * Revoke (delete) a pending pairing request by code without approving it.
 */
export function revokePairingChallenge(code: string): void {
  ensurePairingTable();
  const db = getDb();
  db.prepare("DELETE FROM pairing_requests WHERE code = ?").run(code.toUpperCase().trim());
  log.info({ code }, "Pairing challenge revoked");
}

/**
 * List pending (non-expired) pairing requests, optionally filtered by channel.
 */
export function listPendingPairings(channelId?: string): PairingRequest[] {
  ensurePairingTable();
  purgeExpired();

  const db = getDb();
  const now = nowSeconds();

  if (channelId) {
    return db
      .prepare(
        `SELECT id, channel_id as channelId, sender_id as senderId, code, expires_at as expiresAt, created_at as createdAt
         FROM pairing_requests WHERE channel_id = ? AND expires_at > ? ORDER BY id ASC`,
      )
      .all(channelId, now) as PairingRequest[];
  }

  return db
    .prepare(
      `SELECT id, channel_id as channelId, sender_id as senderId, code, expires_at as expiresAt, created_at as createdAt
       FROM pairing_requests WHERE expires_at > ? ORDER BY id ASC`,
    )
    .all(now) as PairingRequest[];
}
