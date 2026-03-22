import crypto from "node:crypto";
import fs from "node:fs";
import { getDb } from "./db.js";
import { createLogger } from "./logger.js";

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
  } else {
    const keyPath = process.env.NEXUS_MASTER_KEY;
    if (keyPath) {
      masterKey = Buffer.from(fs.readFileSync(keyPath, "utf8").trim(), "hex");
    } else {
      masterKey = crypto.randomBytes(KEY_LENGTH);
      log.warn("Using ephemeral master key — credentials will not persist across restarts");
    }
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

export function retrieveCredential(id: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT encrypted_value, iv, tag FROM credentials WHERE id = ?")
    .get(id) as { encrypted_value: Buffer; iv: Buffer; tag: Buffer } | undefined;
  if (!row) return null;
  return decrypt(row.encrypted_value, row.iv, row.tag);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = crypto.createHash("sha256").update(a).digest();
  const bufB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}
