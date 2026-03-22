/**
 * DM pairing tests.
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

let tmpDir: string;

function setupTestDb(): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-pairing-test-"));
  process.env.NEXUS_DATA_DIR = tmpDir;
}

function teardownTestDb(): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function getModules() {
  const { runMigrations, getDb } = await import("@nexus/core");
  const {
    createPairingChallenge,
    approvePairing,
    revokePairingChallenge,
    listPendingPairings,
    ensurePairingTable,
  } = await import("../pairing.js");
  const { checkAllowlist } = await import("../allowlist.js");
  return {
    runMigrations,
    getDb,
    createPairingChallenge,
    approvePairing,
    revokePairingChallenge,
    listPendingPairings,
    ensurePairingTable,
    checkAllowlist,
  };
}

describe("pairing", () => {
  let mods: Awaited<ReturnType<typeof getModules>>;

  beforeEach(async () => {
    setupTestDb();
    mods = await getModules();
    mods.runMigrations();
    mods.ensurePairingTable();
    mods.getDb().prepare("DELETE FROM pairing_requests").run();
    mods.getDb().prepare("DELETE FROM allowlist").run();
  });

  afterEach(() => {
    teardownTestDb();
  });

  it("creates a challenge and returns an 8-character uppercase code", () => {
    const code = mods.createPairingChallenge("slack", "user_abc");
    expect(code.length).toBe(8);
    expect(code).toMatch(/^[A-Z2-9]+$/);
  });

  it("different calls produce different codes", () => {
    // Drain pending slots by using different senders
    const code1 = mods.createPairingChallenge("slack", "sender_x");
    const code2 = mods.createPairingChallenge("slack", "sender_y");
    expect(code1).not.toBe(code2);
  });

  it("approving a valid code adds the sender to the allowlist", () => {
    const code = mods.createPairingChallenge("slack", "new_user");
    const approved = mods.approvePairing("slack", code);

    expect(approved).toBe("new_user");
    const check = mods.checkAllowlist("slack", "new_user");
    expect(check.allowed).toBe(true);
  });

  it("approving removes the pending request", () => {
    const code = mods.createPairingChallenge("slack", "new_user2");
    mods.approvePairing("slack", code);

    const pending = mods.listPendingPairings("slack");
    expect(pending.length).toBe(0);
  });

  it("throws when approving an unknown code", () => {
    expect(() => mods.approvePairing("slack", "XXXXXXXX")).toThrow(/not found or expired/);
  });

  it("throws when approving a code for the wrong channel", () => {
    const code = mods.createPairingChallenge("slack", "user_z");
    expect(() => mods.approvePairing("whatsapp", code)).toThrow(/not found or expired/);
  });

  it("rejects approving an expired code", () => {
    const db = mods.getDb();
    mods.createPairingChallenge("slack", "old_user");
    // Back-date the expiry
    db.prepare("UPDATE pairing_requests SET expires_at = ? WHERE sender_id = ?").run(
      Math.floor(Date.now() / 1000) - 10,
      "old_user",
    );
    const pending = mods.listPendingPairings("slack");
    expect(pending.length).toBe(0);

    expect(() => {
      // listPendingPairings already purged it; approve should also fail
      const rows = db
        .prepare("SELECT code FROM pairing_requests WHERE sender_id = ?")
        .all("old_user") as { code: string }[];
      if (rows.length === 0) throw new Error("not found or expired");
      mods.approvePairing("slack", rows[0].code);
    }).toThrow(/not found or expired/);
  });

  it("enforces MAX_PENDING_PER_SENDER (3) limit", () => {
    mods.createPairingChallenge("slack", "flood_user");
    mods.createPairingChallenge("slack", "flood_user");
    mods.createPairingChallenge("slack", "flood_user");

    expect(() => mods.createPairingChallenge("slack", "flood_user")).toThrow(/3 pending pairing requests/);
  });

  it("revoking a challenge removes it from pending list", () => {
    const code = mods.createPairingChallenge("slack", "revoke_user");
    mods.revokePairingChallenge(code);

    const pending = mods.listPendingPairings("slack");
    expect(pending.length).toBe(0);
  });

  it("listPendingPairings filters by channelId", () => {
    mods.createPairingChallenge("slack", "sl_user");
    mods.createPairingChallenge("whatsapp", "wa_user");

    const slackPending = mods.listPendingPairings("slack");
    expect(slackPending.length).toBe(1);
    expect(slackPending[0].channelId).toBe("slack");
  });

  it("code comparison is case-insensitive", () => {
    const code = mods.createPairingChallenge("slack", "ci_user");
    // approvePairing normalises to uppercase — pass lowercase
    const approved = mods.approvePairing("slack", code.toLowerCase());
    expect(approved).toBe("ci_user");
  });
});
