/**
 * Allowlist tests.
 *
 * Uses an in-memory SQLite database via NEXUS_DATA_DIR pointing at a temp dir.
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

// ── Test-db bootstrap ────────────────────────────────────────────────────────

let tmpDir: string;

function setupTestDb(): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-allowlist-test-"));
  process.env.NEXUS_DATA_DIR = tmpDir;
}

function teardownTestDb(): void {
  // Force the singleton to close so the next test suite gets a fresh one
  // We do this by deleting the require cache / reloading — but since we use
  // ESM modules we instead rely on each test file using its own temp dir.
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getModules() {
  const { runMigrations, getDb } = await import("@nexus/core");
  const {
    checkAllowlist,
    addAllowlistEntry,
    removeAllowlistEntry,
    listAllowlistEntries,
  } = await import("../allowlist.js");
  return { runMigrations, getDb, checkAllowlist, addAllowlistEntry, removeAllowlistEntry, listAllowlistEntries };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("allowlist", () => {
  let mods: Awaited<ReturnType<typeof getModules>>;

  beforeEach(async () => {
    setupTestDb();
    mods = await getModules();
    mods.runMigrations();
    // Wipe allowlist between tests for isolation
    mods.getDb().prepare("DELETE FROM allowlist").run();
  });

  afterEach(() => {
    teardownTestDb();
  });

  it("allows all senders when no rules are configured", () => {
    const result = mods.checkAllowlist("slack", "user123");
    expect(result.allowed).toBe(true);
    expect(result.reason).toMatch(/no rules configured/);
  });

  it("allows a sender that matches an explicit allow rule", () => {
    mods.addAllowlistEntry("slack", "user123", "allow");
    const result = mods.checkAllowlist("slack", "user123");
    expect(result.allowed).toBe(true);
    expect(result.reason).toMatch(/allow rule/);
  });

  it("denies a sender that matches a deny rule", () => {
    mods.addAllowlistEntry("slack", "spammer", "deny");
    const result = mods.checkAllowlist("slack", "spammer");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/deny rule/);
  });

  it("denies by default when rules exist but none match the sender", () => {
    mods.addAllowlistEntry("slack", "allowed_user", "allow");
    const result = mods.checkAllowlist("slack", "unknown_user");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/deny by default/);
  });

  it("supports wildcard patterns with *", () => {
    mods.addAllowlistEntry("whatsapp", "+1415*", "allow");
    expect(mods.checkAllowlist("whatsapp", "+14155551234").allowed).toBe(true);
    expect(mods.checkAllowlist("whatsapp", "+12125551234").allowed).toBe(false);
  });

  it("global rules (channel=null) apply to all channels", () => {
    mods.addAllowlistEntry(null, "admin", "allow");
    expect(mods.checkAllowlist("slack", "admin").allowed).toBe(true);
    expect(mods.checkAllowlist("whatsapp", "admin").allowed).toBe(true);
  });

  it("per-channel rules take precedence over global rules", () => {
    // Global: deny admin
    mods.addAllowlistEntry(null, "admin", "deny");
    // Per-channel: allow admin on slack
    mods.addAllowlistEntry("slack", "admin", "allow");

    expect(mods.checkAllowlist("slack", "admin").allowed).toBe(true);
    expect(mods.checkAllowlist("whatsapp", "admin").allowed).toBe(false);
  });

  it("removes an entry by id and re-evaluates correctly", () => {
    mods.addAllowlistEntry("slack", "temp_user", "allow");
    const entries = mods.listAllowlistEntries("slack");
    expect(entries.length).toBe(1);

    mods.removeAllowlistEntry(entries[0].id);
    // After removal: rules exist (none left for this channel), but actually no rules → allow
    // Actually since we deleted the only rule, there are now no rules at all → open
    const result = mods.checkAllowlist("slack", "temp_user");
    expect(result.allowed).toBe(true);
  });

  it("listAllowlistEntries filters by channel", () => {
    mods.addAllowlistEntry("slack", "user_a", "allow");
    mods.addAllowlistEntry("whatsapp", "user_b", "allow");
    mods.addAllowlistEntry(null, "global_user", "allow");

    const slackEntries = mods.listAllowlistEntries("slack");
    expect(slackEntries.length).toBe(1);
    expect(slackEntries[0].pattern).toBe("user_a");
  });

  it("supports single-character ? wildcard", () => {
    mods.addAllowlistEntry("sms", "user?", "allow");
    expect(mods.checkAllowlist("sms", "userA").allowed).toBe(true);
    expect(mods.checkAllowlist("sms", "user").allowed).toBe(false);
    expect(mods.checkAllowlist("sms", "userAB").allowed).toBe(false);
  });
});
