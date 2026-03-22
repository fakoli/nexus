/**
 * secrets.test.ts
 *
 * Tests for the `nexus secrets` command: set, list, delete, rotate.
 * Uses a temp data directory and real SQLite so we test the full stack.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// ── Temp dir isolation ────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "nexus-secrets-test-"));
  process.env.NEXUS_DATA_DIR = tmpDir;

  // Ensure a fresh DB + master key for every test.
  // runMigrations must come before initMasterKey because the passphrase
  // path calls getOrCreateSalt() which reads from the config table.
  const { runMigrations, initMasterKey } = await import("@nexus/core");
  runMigrations();
  initMasterKey("test-passphrase");
});

afterEach(async () => {
  vi.restoreAllMocks();
  const { closeDb } = await import("@nexus/core");
  closeDb();
  delete process.env.NEXUS_DATA_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Command structure ─────────────────────────────────────────────────────────

describe("secretsCommand: command structure", () => {
  it("exports a Command named 'secrets'", async () => {
    const { secretsCommand } = await import("../commands/secrets.js");
    expect(secretsCommand.name()).toBe("secrets");
  });

  it("has a 'set' sub-command", async () => {
    const { secretsCommand } = await import("../commands/secrets.js");
    const names = secretsCommand.commands.map((c) => c.name());
    expect(names).toContain("set");
  });

  it("has a 'list' sub-command", async () => {
    const { secretsCommand } = await import("../commands/secrets.js");
    const names = secretsCommand.commands.map((c) => c.name());
    expect(names).toContain("list");
  });

  it("has a 'delete' sub-command", async () => {
    const { secretsCommand } = await import("../commands/secrets.js");
    const names = secretsCommand.commands.map((c) => c.name());
    expect(names).toContain("delete");
  });

  it("has a 'rotate' sub-command", async () => {
    const { secretsCommand } = await import("../commands/secrets.js");
    const names = secretsCommand.commands.map((c) => c.name());
    expect(names).toContain("rotate");
  });
});

// ── set ───────────────────────────────────────────────────────────────────────

describe("secrets set", () => {
  it("stores a credential that can be retrieved", async () => {
    const { storeCredential, retrieveCredential } = await import("@nexus/core");
    storeCredential("anthropic_api_key", "anthropic", "sk-ant-abc123");
    const val = retrieveCredential("anthropic_api_key");
    expect(val).toBe("sk-ant-abc123");
  });

  it("overwrites an existing credential for the same provider", async () => {
    const { storeCredential, retrieveCredential } = await import("@nexus/core");
    storeCredential("openai_api_key", "openai", "first-value");
    storeCredential("openai_api_key", "openai", "second-value");
    const val = retrieveCredential("openai_api_key");
    expect(val).toBe("second-value");
  });

  it("stores credentials for multiple providers independently", async () => {
    const { storeCredential, retrieveCredential } = await import("@nexus/core");
    storeCredential("anthropic_api_key", "anthropic", "ant-key");
    storeCredential("openai_api_key", "openai", "oai-key");
    expect(retrieveCredential("anthropic_api_key")).toBe("ant-key");
    expect(retrieveCredential("openai_api_key")).toBe("oai-key");
  });
});

// ── list ──────────────────────────────────────────────────────────────────────

describe("secrets list", () => {
  it("returns empty results when no credentials are stored", async () => {
    const { getDb } = await import("@nexus/core");
    const db = getDb();
    const rows = db
      .prepare("SELECT id, provider FROM credentials ORDER BY provider")
      .all() as { id: string; provider: string }[];
    expect(rows).toHaveLength(0);
  });

  it("returns a row for each stored credential", async () => {
    const { storeCredential, getDb } = await import("@nexus/core");
    storeCredential("anthropic_api_key", "anthropic", "key-a");
    storeCredential("openai_api_key", "openai", "key-b");

    const db = getDb();
    const rows = db
      .prepare("SELECT id, provider FROM credentials ORDER BY provider")
      .all() as { id: string; provider: string }[];
    expect(rows).toHaveLength(2);
    const providers = rows.map((r) => r.provider).sort();
    expect(providers).toEqual(["anthropic", "openai"]);
  });

  it("stored values are encrypted (not plaintext) in DB", async () => {
    const { storeCredential, getDb } = await import("@nexus/core");
    const plaintext = "sk-supersecret";
    storeCredential("anthropic_api_key", "anthropic", plaintext);

    const db = getDb();
    const row = db
      .prepare("SELECT encrypted_value FROM credentials WHERE id = ?")
      .get("anthropic_api_key") as { encrypted_value: Buffer } | undefined;

    expect(row).toBeDefined();
    // The stored blob should not equal the plaintext bytes
    expect(row!.encrypted_value.toString("utf8")).not.toBe(plaintext);
  });
});

// ── delete ────────────────────────────────────────────────────────────────────

describe("secrets delete", () => {
  it("removes a stored credential", async () => {
    const { storeCredential, retrieveCredential, getDb } = await import("@nexus/core");
    storeCredential("anthropic_api_key", "anthropic", "key-to-delete");

    const db = getDb();
    db.prepare("DELETE FROM credentials WHERE id = ?").run("anthropic_api_key");

    const val = retrieveCredential("anthropic_api_key");
    expect(val).toBeNull();
  });

  it("returns changes = 0 when deleting a non-existent credential", async () => {
    const { getDb } = await import("@nexus/core");
    const db = getDb();
    const info = db
      .prepare("DELETE FROM credentials WHERE id = ?")
      .run("nonexistent_api_key");
    expect(info.changes).toBe(0);
  });

  it("only removes the targeted provider's credential", async () => {
    const { storeCredential, retrieveCredential, getDb } = await import("@nexus/core");
    storeCredential("anthropic_api_key", "anthropic", "keep-me");
    storeCredential("openai_api_key", "openai", "delete-me");

    const db = getDb();
    db.prepare("DELETE FROM credentials WHERE id = ?").run("openai_api_key");

    expect(retrieveCredential("anthropic_api_key")).toBe("keep-me");
    expect(retrieveCredential("openai_api_key")).toBeNull();
  });
});

// ── encrypt / decrypt roundtrip ───────────────────────────────────────────────

describe("secrets: credential encryption roundtrip", () => {
  it("encrypt then decrypt returns original plaintext", async () => {
    const { encrypt, decrypt } = await import("@nexus/core");
    const original = "my-secret-api-key-12345";
    const { encrypted, iv, tag } = encrypt(original);
    const result = decrypt(encrypted, iv, tag);
    expect(result).toBe(original);
  });

  it("ciphertext differs from plaintext", async () => {
    const { encrypt } = await import("@nexus/core");
    const plaintext = "secret";
    const { encrypted } = encrypt(plaintext);
    expect(encrypted.toString("utf8")).not.toBe(plaintext);
  });

  it("two encryptions of the same value produce different ciphertexts (random IV)", async () => {
    const { encrypt } = await import("@nexus/core");
    const { encrypted: e1 } = encrypt("same");
    const { encrypted: e2 } = encrypt("same");
    expect(e1.toString("hex")).not.toBe(e2.toString("hex"));
  });
});
