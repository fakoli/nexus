import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb, getDataDir } from "./db.js";
import { createLogger } from "./logger.js";
import { events } from "./events.js";

const log = createLogger("core:crypto");

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

let masterKey: Buffer | null = null;

const SALT_KEY = "nexus_master_key_salt";

function getOrCreateSalt(): Buffer {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM config WHERE key = ?")
    .get(SALT_KEY) as { value: string } | undefined;
  if (row) {
    return Buffer.from(JSON.parse(row.value) as string, "hex");
  }
  const salt = crypto.randomBytes(32);
  db.prepare(
    "INSERT INTO config (key, value, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(key) DO NOTHING",
  ).run(SALT_KEY, JSON.stringify(salt.toString("hex")));
  return salt;
}

export function initMasterKey(passphrase?: string): void {
  if (passphrase) {
    const salt = getOrCreateSalt();
    masterKey = crypto.pbkdf2Sync(passphrase, salt, 100_000, KEY_LENGTH, "sha512");
    return;
  }

  // 1. Prefer explicit env var (raw hex string).
  const envKey = process.env.NEXUS_MASTER_KEY;
  if (envKey) {
    masterKey = Buffer.from(envKey.trim(), "hex");
    log.info("Master key loaded from NEXUS_MASTER_KEY env var");
    return;
  }

  // 2. Fall back to persisted file, creating it on first run.
  const keyPath = path.join(getDataDir(), "master.key");
  if (fs.existsSync(keyPath)) {
    masterKey = Buffer.from(fs.readFileSync(keyPath, "utf8").trim(), "hex");
    log.info({ path: keyPath }, "Master key loaded from file");
  } else {
    masterKey = crypto.randomBytes(KEY_LENGTH);
    fs.writeFileSync(keyPath, masterKey.toString("hex"), { mode: 0o600 });
    log.info({ path: keyPath }, "New master key generated and persisted");
  }
}

function getMasterKey(): Buffer {
  if (!masterKey) {
    initMasterKey();
  }
  if (!masterKey) {
    throw new Error("Master key could not be initialized");
  }
  return masterKey;
}

export function encrypt(plaintext: string): { encrypted: Buffer; iv: Buffer; tag: Buffer } {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { encrypted, iv, tag };
}

export function decrypt(encrypted: Buffer, iv: Buffer, tag: Buffer): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, getMasterKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function storeCredential(id: string, provider: string, value: string): void {
  const { encrypted, iv, tag } = encrypt(value);
  const db = getDb();
  db.prepare(
    `INSERT INTO credentials (id, provider, encrypted_value, iv, tag, updated_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(id) DO UPDATE SET
       provider = excluded.provider,
       encrypted_value = excluded.encrypted_value,
       iv = excluded.iv,
       tag = excluded.tag,
       updated_at = excluded.updated_at`,
  ).run(id, provider, encrypted, iv, tag);
  log.info({ id, provider }, "Credential stored");
}

export function storeCredentialWithExpiry(
  id: string,
  provider: string,
  value: string,
  expiresAt?: number,
): void {
  const { encrypted, iv, tag } = encrypt(value);
  const db = getDb();
  db.prepare(
    `INSERT INTO credentials (id, provider, encrypted_value, iv, tag, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(id) DO UPDATE SET
       provider = excluded.provider,
       encrypted_value = excluded.encrypted_value,
       iv = excluded.iv,
       tag = excluded.tag,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
  ).run(id, provider, encrypted, iv, tag, expiresAt ?? null);
  log.info({ id, provider, expiresAt }, "Credential stored with expiry");
  events.emit("audit:entry", { eventType: "credential:stored", actor: id });
}

export function isCredentialExpired(id: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT expires_at FROM credentials WHERE id = ?")
    .get(id) as { expires_at: number | null } | undefined;
  if (!row) return true; // not found — treat as expired/invalid
  if (row.expires_at === null) return false; // no expiry set
  return Math.floor(Date.now() / 1000) >= row.expires_at;
}

export interface ExpiringCredential {
  id: string;
  provider: string;
  expiresAt: number;
}

export function listExpiringCredentials(withinMs: number): ExpiringCredential[] {
  const db = getDb();
  const nowSec = Math.floor(Date.now() / 1000);
  const thresholdSec = nowSec + Math.floor(withinMs / 1000);
  const rows = db
    .prepare(
      "SELECT id, provider, expires_at FROM credentials WHERE expires_at IS NOT NULL AND expires_at <= ?",
    )
    .all(thresholdSec) as Array<{ id: string; provider: string; expires_at: number }>;
  return rows.map((r) => ({ id: r.id, provider: r.provider, expiresAt: r.expires_at }));
}

export function retrieveCredential(id: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT encrypted_value, iv, tag FROM credentials WHERE id = ?")
    .get(id) as { encrypted_value: Buffer; iv: Buffer; tag: Buffer } | undefined;
  if (!row) return null;
  events.emit("audit:entry", { eventType: "credential:accessed", actor: id });
  return decrypt(row.encrypted_value, row.iv, row.tag);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = crypto.createHash("sha256").update(a).digest();
  const bufB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}
