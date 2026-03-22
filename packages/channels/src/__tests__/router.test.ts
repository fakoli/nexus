/**
 * Router tests.
 *
 * The router calls runAgent() and adapter.sendReply(). Both are stubbed here
 * so no real LLM calls are made.
 */

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

let tmpDir: string;

function setupTestDb(): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-router-test-"));
  process.env.NEXUS_DATA_DIR = tmpDir;
}

function teardownTestDb(): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ── Minimal stub adapter ──────────────────────────────────────────────────────

function makeAdapter(id = "test_channel") {
  const sent: { target: string; content: string }[] = [];
  return {
    adapter: {
      id,
      name: "Test Channel",
      capabilities: { dm: true, group: false, media: false, reactions: false, markdown: true },
      start: async () => {},
      stop: async () => {},
      sendReply: async (target: string, content: string) => {
        sent.push({ target, content });
      },
    },
    sent,
  };
}

async function getModules() {
  const { runMigrations, getDb, setConfig } = await import("@nexus/core");
  const { routeInbound, buildSessionKey } = await import("../router.js");
  const { registerAdapter, _resetRegistry } = await import("../registry.js");
  const { addAllowlistEntry } = await import("../allowlist.js");
  const { ensurePairingTable } = await import("../pairing.js");
  return {
    runMigrations,
    getDb,
    setConfig,
    routeInbound,
    buildSessionKey,
    registerAdapter,
    _resetRegistry,
    addAllowlistEntry,
    ensurePairingTable,
  };
}

describe("router", () => {
  let mods: Awaited<ReturnType<typeof getModules>>;

  beforeEach(async () => {
    setupTestDb();
    mods = await getModules();
    mods.runMigrations();
    mods.ensurePairingTable();
    mods._resetRegistry();
    mods.getDb().prepare("DELETE FROM allowlist").run();
    mods.getDb().prepare("DELETE FROM pairing_requests").run();
    mods.getDb().prepare("DELETE FROM sessions").run();
    mods.getDb().prepare("DELETE FROM messages").run();
    mods.getDb().prepare("DELETE FROM agents WHERE id != 'default'").run();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    teardownTestDb();
  });

  it("buildSessionKey formats correctly", () => {
    const key = mods.buildSessionKey("slack", "user1", "agent_x");
    expect(key).toBe("slack:user1:agent_x");
  });

  it("drops message when no adapter is registered for channel", async () => {
    // Should not throw even though there's no adapter
    await expect(mods.routeInbound("nonexistent_channel", "user1", "hello")).resolves.not.toThrow();
  });

  it("denies sender not on allowlist (strict policy) and sends Access denied", async () => {
    const { adapter, sent } = makeAdapter("strict_ch");
    mods.registerAdapter(adapter);

    // Set strict policy
    mods.setConfig("channels.strict_ch.routing", { policy: "strict", agentId: "default" });

    // Add a rule so allowlist is non-empty but user is not on it
    mods.addAllowlistEntry("strict_ch", "allowed_user", "allow");

    // Mock runAgent so we don't need a real LLM
    const agentMod = await import("@nexus/agent");
    const stub = vi.spyOn(agentMod, "runAgent").mockResolvedValueOnce({
      content: "Hello!",
      sessionId: "s1",
      messageId: 1,
      toolCallCount: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    });

    await mods.routeInbound("strict_ch", "unknown_user", "hi");

    // Adapter should have received the denial message
    expect(sent.length).toBe(1);
    expect(sent[0].content).toMatch(/Access denied/i);
    expect(stub.mock.calls.length).toBe(0);
  });

  it("routes allowed sender to agent and dispatches reply", async () => {
    const { adapter, sent } = makeAdapter("open_ch");
    mods.registerAdapter(adapter);

    // Open policy — no allowlist needed
    mods.setConfig("channels.open_ch.routing", { policy: "open", agentId: "default" });

    const agentMod = await import("@nexus/agent");
    const stub = vi.spyOn(agentMod, "runAgent").mockResolvedValueOnce({
      content: "The answer is 42.",
      sessionId: "open_ch:user99:default",
      messageId: 5,
      toolCallCount: 0,
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    await mods.routeInbound("open_ch", "user99", "What is the answer?");

    expect(stub.mock.calls.length).toBe(1);
    const callOpts = stub.mock.calls[0][0] as { sessionId: string; userMessage: string };
    expect(callOpts.userMessage).toBe("What is the answer?");
    expect(callOpts.sessionId).toBe("open_ch:user99:default");

    expect(sent.length).toBe(1);
    expect(sent[0].target).toBe("user99");
    expect(sent[0].content).toBe("The answer is 42.");
  });

  it("sends pairing challenge to unknown sender on pairing policy channel", async () => {
    const { adapter, sent } = makeAdapter("pair_ch");
    mods.registerAdapter(adapter);

    mods.setConfig("channels.pair_ch.routing", { policy: "pairing", agentId: "default" });

    // Add a rule so allowlist is active but new_user is not on it
    mods.addAllowlistEntry("pair_ch", "known_user", "allow");

    const agentMod = await import("@nexus/agent");
    const stub = vi.spyOn(agentMod, "runAgent").mockResolvedValueOnce({
      content: "ok",
      sessionId: "x",
      messageId: 1,
      toolCallCount: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    });

    await mods.routeInbound("pair_ch", "new_user", "hi");

    expect(sent.length).toBe(1);
    expect(sent[0].content).toMatch(/code/i);
    expect(sent[0].content).toMatch(/[A-Z2-9]{8}/);
    expect(stub.mock.calls.length).toBe(0);
  });

  it("routes allowed sender after pairing approval", async () => {
    const { adapter, sent } = makeAdapter("pair_ch2");
    mods.registerAdapter(adapter);

    mods.setConfig("channels.pair_ch2.routing", { policy: "pairing", agentId: "default" });
    // Activate allowlist with at least one rule so unknown senders are blocked
    mods.addAllowlistEntry("pair_ch2", "other_user", "allow");

    const { approvePairing } = await import("../pairing.js");

    const agentMod = await import("@nexus/agent");
    const stub = vi.spyOn(agentMod, "runAgent").mockResolvedValueOnce({
      content: "Approved reply!",
      sessionId: "pair_ch2:new_sender:default",
      messageId: 2,
      toolCallCount: 0,
      usage: { inputTokens: 5, outputTokens: 10 },
    });

    // First message → challenge
    await mods.routeInbound("pair_ch2", "new_sender", "hello");
    expect(sent.length).toBe(1);
    const challengeContent = sent[0].content;
    const codeMatch = challengeContent.match(/[A-Z2-9]{8}/);
    expect(codeMatch).toBeTruthy();
    const code = codeMatch![0];

    // Approve via pairing
    approvePairing("pair_ch2", code);

    // Second message → should be routed
    await mods.routeInbound("pair_ch2", "new_sender", "hello again");
    expect(stub.mock.calls.length).toBe(1);
    expect(sent[1].content).toBe("Approved reply!");
  });

  it("recovers gracefully when runAgent throws", async () => {
    const { adapter, sent } = makeAdapter("err_ch");
    mods.registerAdapter(adapter);
    mods.setConfig("channels.err_ch.routing", { policy: "open", agentId: "default" });

    const agentMod = await import("@nexus/agent");
    vi.spyOn(agentMod, "runAgent").mockRejectedValueOnce(new Error("LLM unavailable"));

    await expect(mods.routeInbound("err_ch", "user1", "hello")).resolves.not.toThrow();

    expect(sent.length).toBe(1);
    expect(sent[0].content).toMatch(/error/i);
  });
});
