/**
 * E4: Credential Rotation + Audit tests.
 *
 * Verifies:
 * - storeCredentialWithExpiry stores with optional expiry
 * - isCredentialExpired correctly detects expired/active/absent credentials
 * - listExpiringCredentials returns credentials expiring within a timeframe
 * - audit events emitted on access and store
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-cred-rotation-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import("../db.js");
  db.closeDb();
  db.runMigrations();
  return db;
}

// ── storeCredentialWithExpiry ─────────────────────────────────────────────────

describe("storeCredentialWithExpiry", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { initMasterKey } = await import("../crypto.js");
    initMasterKey("test-passphrase");
  });

  afterEach(async () => {
    const { closeDb } = await import("../db.js");
    closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("stores a credential without expiry (retrievable)", async () => {
    const { storeCredentialWithExpiry, retrieveCredential } = await import("../crypto.js");
    storeCredentialWithExpiry("cred-no-expiry", "test-provider", "secret-value");
    const retrieved = retrieveCredential("cred-no-expiry");
    expect(retrieved).toBe("secret-value");
  });

  it("stores a credential with a future expiry (not expired)", async () => {
    const { storeCredentialWithExpiry, isCredentialExpired } = await import("../crypto.js");
    const futureTs = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    storeCredentialWithExpiry("cred-future", "test-provider", "my-token", futureTs);
    expect(isCredentialExpired("cred-future")).toBe(false);
  });

  it("stores a credential with a past expiry (expired)", async () => {
    const { storeCredentialWithExpiry, isCredentialExpired } = await import("../crypto.js");
    const pastTs = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    storeCredentialWithExpiry("cred-past", "test-provider", "old-token", pastTs);
    expect(isCredentialExpired("cred-past")).toBe(true);
  });

  it("overwrites an existing credential and updates expiry", async () => {
    const { storeCredentialWithExpiry, retrieveCredential, isCredentialExpired } =
      await import("../crypto.js");
    const pastTs = Math.floor(Date.now() / 1000) - 100;
    storeCredentialWithExpiry("cred-overwrite", "prov", "old", pastTs);
    expect(isCredentialExpired("cred-overwrite")).toBe(true);

    const futureTs = Math.floor(Date.now() / 1000) + 7200;
    storeCredentialWithExpiry("cred-overwrite", "prov", "new-value", futureTs);
    expect(isCredentialExpired("cred-overwrite")).toBe(false);
    expect(retrieveCredential("cred-overwrite")).toBe("new-value");
  });
});

// ── isCredentialExpired ───────────────────────────────────────────────────────

describe("isCredentialExpired", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { initMasterKey } = await import("../crypto.js");
    initMasterKey("test-passphrase");
  });

  afterEach(async () => {
    const { closeDb } = await import("../db.js");
    closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns true for a non-existent credential", async () => {
    const { isCredentialExpired } = await import("../crypto.js");
    expect(isCredentialExpired("ghost-credential")).toBe(true);
  });

  it("returns false for a credential with no expiry set", async () => {
    const { storeCredential, isCredentialExpired } = await import("../crypto.js");
    storeCredential("no-expiry-cred", "prov", "value");
    expect(isCredentialExpired("no-expiry-cred")).toBe(false);
  });

  it("returns false for a credential expiring in the future", async () => {
    const { storeCredentialWithExpiry, isCredentialExpired } = await import("../crypto.js");
    const future = Math.floor(Date.now() / 1000) + 86400;
    storeCredentialWithExpiry("future-cred", "prov", "value", future);
    expect(isCredentialExpired("future-cred")).toBe(false);
  });

  it("returns true for a credential that expired in the past", async () => {
    const { storeCredentialWithExpiry, isCredentialExpired } = await import("../crypto.js");
    const past = Math.floor(Date.now() / 1000) - 1;
    storeCredentialWithExpiry("expired-cred", "prov", "value", past);
    expect(isCredentialExpired("expired-cred")).toBe(true);
  });
});

// ── listExpiringCredentials ───────────────────────────────────────────────────

describe("listExpiringCredentials", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { initMasterKey } = await import("../crypto.js");
    initMasterKey("test-passphrase");
  });

  afterEach(async () => {
    const { closeDb } = await import("../db.js");
    closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when no credentials exist", async () => {
    const { listExpiringCredentials } = await import("../crypto.js");
    expect(listExpiringCredentials(3600_000)).toEqual([]);
  });

  it("returns credentials expiring within the given window", async () => {
    const { storeCredentialWithExpiry, listExpiringCredentials } = await import("../crypto.js");
    const soon = Math.floor(Date.now() / 1000) + 1800; // 30 minutes from now
    storeCredentialWithExpiry("expiring-soon", "openai", "key-abc", soon);

    const expiring = listExpiringCredentials(3600_000); // within 1 hour
    const ids = expiring.map((e) => e.id);
    expect(ids).toContain("expiring-soon");
  });

  it("does not return credentials expiring beyond the window", async () => {
    const { storeCredentialWithExpiry, listExpiringCredentials } = await import("../crypto.js");
    const farFuture = Math.floor(Date.now() / 1000) + 86400; // 24 hours from now
    storeCredentialWithExpiry("far-future", "anthropic", "key-xyz", farFuture);

    const expiring = listExpiringCredentials(3600_000); // within 1 hour
    const ids = expiring.map((e) => e.id);
    expect(ids).not.toContain("far-future");
  });

  it("does not return credentials with no expiry set", async () => {
    const { storeCredential, listExpiringCredentials } = await import("../crypto.js");
    storeCredential("no-expiry", "prov", "value");
    const expiring = listExpiringCredentials(3600_000 * 24 * 365); // 1 year
    const ids = expiring.map((e) => e.id);
    expect(ids).not.toContain("no-expiry");
  });

  it("returns correct provider and expiresAt fields", async () => {
    const { storeCredentialWithExpiry, listExpiringCredentials } = await import("../crypto.js");
    const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes
    storeCredentialWithExpiry("soon-2", "anthropic", "key", expiresAt);

    const expiring = listExpiringCredentials(3600_000);
    const entry = expiring.find((e) => e.id === "soon-2");
    expect(entry).toBeDefined();
    expect(entry?.provider).toBe("anthropic");
    expect(entry?.expiresAt).toBe(expiresAt);
  });

  it("also returns already-expired credentials (expired within window)", async () => {
    const { storeCredentialWithExpiry, listExpiringCredentials } = await import("../crypto.js");
    const past = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
    storeCredentialWithExpiry("already-expired", "prov", "old", past);

    const expiring = listExpiringCredentials(3600_000);
    const ids = expiring.map((e) => e.id);
    expect(ids).toContain("already-expired");
  });
});

// ── Audit events ──────────────────────────────────────────────────────────────

describe("credential audit events", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { initMasterKey } = await import("../crypto.js");
    initMasterKey("test-passphrase");
  });

  afterEach(async () => {
    const { closeDb } = await import("../db.js");
    closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("emits audit:entry event when credential is stored with expiry", async () => {
    const { events } = await import("../events.js");
    const { storeCredentialWithExpiry } = await import("../crypto.js");

    const captured: Array<{ eventType: string }> = [];
    const handler = (payload: { eventType: string; actor?: string }) => {
      captured.push(payload);
    };
    events.on("audit:entry", handler);
    storeCredentialWithExpiry("audit-store-test", "prov", "value");
    events.off("audit:entry", handler);

    const stored = captured.find((p) => p.eventType === "credential:stored");
    expect(stored).toBeDefined();
  });

  it("emits audit:entry event when credential is accessed", async () => {
    const { storeCredential } = await import("../crypto.js");
    storeCredential("audit-access-test", "prov", "value");

    const { events } = await import("../events.js");
    const { retrieveCredential } = await import("../crypto.js");

    const captured: Array<{ eventType: string }> = [];
    const handler = (payload: { eventType: string; actor?: string }) => {
      captured.push(payload);
    };
    events.on("audit:entry", handler);
    retrieveCredential("audit-access-test");
    events.off("audit:entry", handler);

    const accessed = captured.find((p) => p.eventType === "credential:accessed");
    expect(accessed).toBeDefined();
  });
});
