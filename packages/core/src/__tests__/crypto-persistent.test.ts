/**
 * crypto-persistent.test.ts
 *
 * Tests for the persistent master key behaviour in packages/core/src/crypto.ts:
 *   - Key is generated and written to master.key on first run
 *   - Subsequent calls load the same key from the file
 *   - NEXUS_MASTER_KEY env var overrides the file
 * Uses a temp directory to avoid touching ~/.nexus.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// ── Temp dir isolation ────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "nexus-crypto-persist-"));
  process.env.NEXUS_DATA_DIR = tmpDir;
  // Ensure no env-var override bleeds between tests
  delete process.env.NEXUS_MASTER_KEY;
});

afterEach(async () => {
  const { closeDb } = await import("../db.js");
  closeDb();
  delete process.env.NEXUS_DATA_DIR;
  delete process.env.NEXUS_MASTER_KEY;
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helper: reset the module-level masterKey singleton ────────────────────────
async function resetAndInit(passphrase?: string): Promise<void> {
  // Re-importing with the same module cache won't reset the singleton,
  // so we call initMasterKey() explicitly to force a re-init.
  const { initMasterKey } = await import("../crypto.js");
  initMasterKey(passphrase);
}

// ── Key file generation on first run ─────────────────────────────────────────

describe("persistent master key: first run", () => {
  it("creates master.key file on first initMasterKey() call (no passphrase)", async () => {
    const { runMigrations } = await import("../db.js");
    runMigrations(); // DB must exist before crypto reads/writes config

    await resetAndInit();
    const keyPath = path.join(tmpDir, "master.key");
    expect(existsSync(keyPath)).toBe(true);
  });

  it("master.key contains a 64-character hex string (32 bytes)", async () => {
    const { runMigrations } = await import("../db.js");
    runMigrations();

    await resetAndInit();
    const keyPath = path.join(tmpDir, "master.key");
    const hex = readFileSync(keyPath, "utf8").trim();
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("master.key file is created with restricted permissions (0o600)", async () => {
    const { runMigrations } = await import("../db.js");
    runMigrations();

    await resetAndInit();
    const keyPath = path.join(tmpDir, "master.key");
    const mode = statSync(keyPath).mode & 0o777;
    // On macOS/Linux the file should be 0600; skip on Windows
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600);
    }
  });
});

// ── Key persistence across calls ──────────────────────────────────────────────

describe("persistent master key: persistence", () => {
  it("encrypt + decrypt succeeds across two initMasterKey() calls on the same file", async () => {
    const { runMigrations } = await import("../db.js");
    runMigrations();

    // First init — generates the key
    await resetAndInit();
    const { encrypt } = await import("../crypto.js");
    const { encrypted, iv, tag } = encrypt("persistent test value");

    // Second init — loads key from file
    await resetAndInit();
    const { decrypt } = await import("../crypto.js");
    const result = decrypt(encrypted, iv, tag);
    expect(result).toBe("persistent test value");
  });

  it("does not regenerate the key file if it already exists", async () => {
    const { runMigrations } = await import("../db.js");
    runMigrations();

    await resetAndInit();
    const keyPath = path.join(tmpDir, "master.key");
    const hex1 = readFileSync(keyPath, "utf8").trim();

    // Second call should load, not regenerate
    await resetAndInit();
    const hex2 = readFileSync(keyPath, "utf8").trim();
    expect(hex1).toBe(hex2);
  });

  it("storeCredential then retrieveCredential works with auto-initialised key", async () => {
    const { runMigrations } = await import("../db.js");
    runMigrations();

    await resetAndInit();
    const { storeCredential, retrieveCredential } = await import("../crypto.js");
    storeCredential("persist-cred", "test-provider", "my-value");
    const val = retrieveCredential("persist-cred");
    expect(val).toBe("my-value");
  });
});

// ── NEXUS_MASTER_KEY env var override ─────────────────────────────────────────

describe("persistent master key: env var override", () => {
  it("uses NEXUS_MASTER_KEY when set, not the file", async () => {
    const { runMigrations } = await import("../db.js");
    runMigrations();

    // Generate a known 32-byte key in hex
    const crypto = await import("node:crypto");
    const rawKey = crypto.default.randomBytes(32);
    process.env.NEXUS_MASTER_KEY = rawKey.toString("hex");

    await resetAndInit(); // should pick up env var, not create file
    const keyPath = path.join(tmpDir, "master.key");
    // File should NOT be created because env var takes precedence
    expect(existsSync(keyPath)).toBe(false);
  });

  it("can encrypt and decrypt using the NEXUS_MASTER_KEY env var", async () => {
    const { runMigrations } = await import("../db.js");
    runMigrations();

    const crypto = await import("node:crypto");
    process.env.NEXUS_MASTER_KEY = crypto.default.randomBytes(32).toString("hex");

    await resetAndInit();
    const { encrypt, decrypt } = await import("../crypto.js");
    const { encrypted, iv, tag } = encrypt("env-key-test");
    const result = decrypt(encrypted, iv, tag);
    expect(result).toBe("env-key-test");
  });

  it("env var key (64 hex chars) is accepted as a 32-byte AES-256 key", async () => {
    const { runMigrations } = await import("../db.js");
    runMigrations();

    const crypto = await import("node:crypto");
    const hex = crypto.default.randomBytes(32).toString("hex");
    expect(hex.length).toBe(64); // sanity check

    process.env.NEXUS_MASTER_KEY = hex;
    await resetAndInit();

    const { encrypt, decrypt } = await import("../crypto.js");
    const plain = "verify env key length";
    const { encrypted, iv, tag } = encrypt(plain);
    expect(decrypt(encrypted, iv, tag)).toBe(plain);
  });
});
