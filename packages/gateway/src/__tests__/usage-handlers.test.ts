/**
 * Tests for gateway/handlers/usage.ts
 *
 * Each describe block spins up a fresh SQLite DB so tests remain isolated.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-usage-handlers-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const dbMod = await import("../../../core/src/db.js");
  dbMod.closeDb();
  dbMod.runMigrations();
  const { createAgent } = await import("@nexus/core");
  try { createAgent("agent-u"); } catch { /* already exists */ }
  const { createSession } = await import("@nexus/core");
  try { createSession("sess-u1", "agent-u"); } catch { /* already exists */ }
  return dbMod;
}

async function appendUsage(
  sessionId: string,
  inputTokens: number,
  outputTokens: number,
  model = "claude-sonnet-4-6",
  provider = "anthropic",
) {
  const { appendMessage } = await import("@nexus/core");
  appendMessage(sessionId, "assistant", "reply", { usage: { inputTokens, outputTokens }, model, provider });
}

// ── usage.summary ─────────────────────────────────────────────────────────

describe("handleUsageSummary", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const dbMod = await import("../../../core/src/db.js");
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns ok:true with a summary object", async () => {
    const { handleUsageSummary } = await import("../handlers/usage.js");
    const result = handleUsageSummary({});
    expect(result.ok).toBe(true);
    const payload = result.payload as { summary: unknown };
    expect(payload.summary).toBeDefined();
  });

  it("summary has all required fields when no data", async () => {
    const { handleUsageSummary } = await import("../handlers/usage.js");
    const result = handleUsageSummary({});
    const summary = (result.payload as { summary: Record<string, unknown> }).summary;
    expect(typeof summary.totalInputTokens).toBe("number");
    expect(typeof summary.totalOutputTokens).toBe("number");
    expect(typeof summary.totalTokens).toBe("number");
    expect(typeof summary.estimatedCostUsd).toBe("number");
    expect(typeof summary.sessionCount).toBe("number");
    expect(typeof summary.messageCount).toBe("number");
  });

  it("reflects token counts after messages are appended", async () => {
    await appendUsage("sess-u1", 100, 200);
    const { handleUsageSummary } = await import("../handlers/usage.js");
    const result = handleUsageSummary({});
    const summary = (result.payload as { summary: Record<string, unknown> }).summary;
    expect(summary.totalInputTokens).toBe(100);
    expect(summary.totalOutputTokens).toBe(200);
    expect(summary.totalTokens).toBe(300);
  });

  it("estimatedCostUsd is positive when tokens used", async () => {
    await appendUsage("sess-u1", 500, 250);
    const { handleUsageSummary } = await import("../handlers/usage.js");
    const result = handleUsageSummary({});
    const summary = (result.payload as { summary: Record<string, unknown> }).summary;
    expect(summary.estimatedCostUsd as number).toBeGreaterThan(0);
  });

  it("sessionCount is at least 1 after seeding a session", async () => {
    const { handleUsageSummary } = await import("../handlers/usage.js");
    const result = handleUsageSummary({});
    const summary = (result.payload as { summary: Record<string, unknown> }).summary;
    expect(summary.sessionCount as number).toBeGreaterThanOrEqual(1);
  });
});

// ── usage.by-session ──────────────────────────────────────────────────────

describe("handleUsageBySession", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { createSession } = await import("@nexus/core");
    try { createSession("sess-u2", "agent-u"); } catch { /* exists */ }
  });

  afterEach(async () => {
    const dbMod = await import("../../../core/src/db.js");
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns ok:true with sessions array", async () => {
    const { handleUsageBySession } = await import("../handlers/usage.js");
    const result = handleUsageBySession({});
    expect(result.ok).toBe(true);
    const payload = result.payload as { sessions: unknown[] };
    expect(Array.isArray(payload.sessions)).toBe(true);
  });

  it("returns per-session token breakdown", async () => {
    await appendUsage("sess-u1", 100, 200);
    await appendUsage("sess-u2", 50, 80);
    const { handleUsageBySession } = await import("../handlers/usage.js");
    const result = handleUsageBySession({});
    const payload = result.payload as { sessions: Array<{ sessionId: string; inputTokens: number }> };
    expect(payload.sessions.length).toBe(2);
    const s1 = payload.sessions.find((s) => s.sessionId === "sess-u1");
    expect(s1).toBeDefined();
    expect(s1!.inputTokens).toBe(100);
  });

  it("returns INVALID_PARAMS when limit exceeds 500", async () => {
    const { handleUsageBySession } = await import("../handlers/usage.js");
    const result = handleUsageBySession({ limit: 501 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns INVALID_PARAMS when limit is zero", async () => {
    const { handleUsageBySession } = await import("../handlers/usage.js");
    const result = handleUsageBySession({ limit: 0 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });
});

// ── usage.by-model ────────────────────────────────────────────────────────

describe("handleUsageByModel", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const dbMod = await import("../../../core/src/db.js");
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns ok:true with models array", async () => {
    const { handleUsageByModel } = await import("../handlers/usage.js");
    const result = handleUsageByModel({});
    expect(result.ok).toBe(true);
    const payload = result.payload as { models: unknown[] };
    expect(Array.isArray(payload.models)).toBe(true);
  });

  it("groups tokens by provider and model", async () => {
    await appendUsage("sess-u1", 100, 200, "claude-sonnet-4-6", "anthropic");
    await appendUsage("sess-u1", 50, 80, "gpt-4o", "openai");
    const { handleUsageByModel } = await import("../handlers/usage.js");
    const result = handleUsageByModel({});
    const payload = result.payload as { models: Array<{ provider: string; inputTokens: number }> };
    expect(payload.models.length).toBe(2);
    const anthropicEntry = payload.models.find((m) => m.provider === "anthropic");
    expect(anthropicEntry).toBeDefined();
    expect(anthropicEntry!.inputTokens).toBe(100);
  });

  it("each model entry has estimatedCostUsd", async () => {
    await appendUsage("sess-u1", 1000, 500, "claude-sonnet-4-6", "anthropic");
    const { handleUsageByModel } = await import("../handlers/usage.js");
    const result = handleUsageByModel({});
    const payload = result.payload as { models: Array<{ estimatedCostUsd: number }> };
    expect(payload.models[0].estimatedCostUsd).toBeGreaterThan(0);
  });

  it("ignores params (handler accepts any object)", async () => {
    const { handleUsageByModel } = await import("../handlers/usage.js");
    // handleUsageByModel ignores params entirely — should still succeed
    const result = handleUsageByModel({ unexpected: true });
    expect(result.ok).toBe(true);
  });
});
