import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), "nexus-usage-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import("../db.js");
  db.closeDb();
  db.runMigrations();
  const { createAgent } = await import("../agents.js");
  try { createAgent("agent-1"); } catch { /* exists */ }
  const { createSession } = await import("../sessions.js");
  try { createSession("sess-1", "agent-1"); } catch { /* exists */ }
  return db;
}

/** Append a mock assistant message with usage metadata */
async function appendUsage(sessionId: string, inputTokens: number, outputTokens: number, model = "claude-sonnet-4-6", provider = "anthropic") {
  const { appendMessage } = await import("../sessions.js");
  appendMessage(sessionId, "assistant", "reply", { usage: { inputTokens, outputTokens }, model, provider });
}

describe("usage: getUsageSummary", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const db = await import("../db.js");
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns zero counts when no messages", async () => {
    const { getUsageSummary } = await import("../usage.js");
    const summary = getUsageSummary();
    expect(summary.totalInputTokens).toBe(0);
    expect(summary.totalOutputTokens).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.estimatedCostUsd).toBe(0);
  });

  it("counts tokens from assistant messages", async () => {
    await appendUsage("sess-1", 100, 200);
    const { getUsageSummary } = await import("../usage.js");
    const summary = getUsageSummary();
    expect(summary.totalInputTokens).toBe(100);
    expect(summary.totalOutputTokens).toBe(200);
    expect(summary.totalTokens).toBe(300);
  });

  it("reports positive estimatedCostUsd when tokens used", async () => {
    await appendUsage("sess-1", 1000, 500);
    const { getUsageSummary } = await import("../usage.js");
    const summary = getUsageSummary();
    expect(summary.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("sessionCount reflects number of sessions", async () => {
    const { getUsageSummary } = await import("../usage.js");
    const summary = getUsageSummary();
    expect(summary.sessionCount).toBeGreaterThanOrEqual(1);
  });

  it("messageCount includes all roles", async () => {
    const { appendMessage } = await import("../sessions.js");
    appendMessage("sess-1", "user", "question");
    await appendUsage("sess-1", 50, 80);
    const { getUsageSummary } = await import("../usage.js");
    const summary = getUsageSummary();
    expect(summary.messageCount).toBeGreaterThanOrEqual(2);
  });
});

describe("usage: getUsageBySession", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { createSession } = await import("../sessions.js");
    try { createSession("sess-2", "agent-1"); } catch { /* exists */ }
  });

  afterEach(async () => {
    const db = await import("../db.js");
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when no assistant messages", async () => {
    const { getUsageBySession } = await import("../usage.js");
    expect(getUsageBySession()).toEqual([]);
  });

  it("returns per-session aggregates", async () => {
    await appendUsage("sess-1", 100, 200);
    await appendUsage("sess-2", 50, 75);
    const { getUsageBySession } = await import("../usage.js");
    const result = getUsageBySession();
    expect(result.length).toBe(2);
    const s1 = result.find((r) => r.sessionId === "sess-1");
    expect(s1).toBeDefined();
    expect(s1!.inputTokens).toBe(100);
    expect(s1!.outputTokens).toBe(200);
  });

  it("aggregates multiple messages in same session", async () => {
    await appendUsage("sess-1", 50, 100);
    await appendUsage("sess-1", 30, 60);
    const { getUsageBySession } = await import("../usage.js");
    const result = getUsageBySession();
    const s1 = result.find((r) => r.sessionId === "sess-1");
    expect(s1!.inputTokens).toBe(80);
    expect(s1!.outputTokens).toBe(160);
    expect(s1!.messageCount).toBe(2);
  });
});

describe("usage: getUsageByModel", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const db = await import("../db.js");
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when no messages", async () => {
    const { getUsageByModel } = await import("../usage.js");
    expect(getUsageByModel()).toEqual([]);
  });

  it("groups tokens by model and provider", async () => {
    await appendUsage("sess-1", 100, 200, "claude-sonnet-4-6", "anthropic");
    await appendUsage("sess-1", 50, 80, "gpt-4o", "openai");
    const { getUsageByModel } = await import("../usage.js");
    const result = getUsageByModel();
    expect(result.length).toBe(2);
    const anthropic = result.find((r) => r.provider === "anthropic");
    expect(anthropic).toBeDefined();
    expect(anthropic!.inputTokens).toBe(100);
    expect(anthropic!.estimatedCostUsd).toBeGreaterThan(0);
  });
});

describe("usage: getUsageTimeSeries", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const db = await import("../db.js");
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when no messages in range", async () => {
    const { getUsageTimeSeries } = await import("../usage.js");
    expect(getUsageTimeSeries(1)).toEqual([]);
  });

  it("returns daily buckets for recent messages", async () => {
    await appendUsage("sess-1", 200, 400);
    const { getUsageTimeSeries } = await import("../usage.js");
    const series = getUsageTimeSeries(30);
    expect(series.length).toBeGreaterThanOrEqual(1);
    const today = new Date().toISOString().slice(0, 10);
    const todayEntry = series.find((d) => d.date === today);
    expect(todayEntry).toBeDefined();
    expect(todayEntry!.inputTokens).toBe(200);
    expect(todayEntry!.outputTokens).toBe(400);
  });
});
