/**
 * E3: Rate Limit Hardening tests.
 *
 * Verifies:
 * - RateLimitProfileSchema validates correctly
 * - getRateLimitStatus returns current state
 * - checkRateLimitWithProfile enforces per-minute and per-hour windows
 * - Rate limits work per-client, per-agent, per-tool
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-rl-profiles-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import("../db.js");
  db.closeDb();
  db.runMigrations();
  return db;
}

// ── RateLimitProfileSchema ────────────────────────────────────────────────────

describe("RateLimitProfileSchema: validation", () => {
  it("parses a valid profile with all fields", async () => {
    const { RateLimitProfileSchema } = await import("../rate-limit.js");
    const result = RateLimitProfileSchema.safeParse({
      name: "default",
      requestsPerMinute: 30,
      requestsPerHour: 500,
      burstSize: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("default");
      expect(result.data.requestsPerMinute).toBe(30);
      expect(result.data.requestsPerHour).toBe(500);
      expect(result.data.burstSize).toBe(5);
    }
  });

  it("applies defaults for optional numeric fields", async () => {
    const { RateLimitProfileSchema } = await import("../rate-limit.js");
    const result = RateLimitProfileSchema.safeParse({ name: "minimal" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requestsPerMinute).toBe(60);
      expect(result.data.requestsPerHour).toBe(1000);
      expect(result.data.burstSize).toBe(10);
    }
  });

  it("rejects requestsPerMinute < 1", async () => {
    const { RateLimitProfileSchema } = await import("../rate-limit.js");
    const result = RateLimitProfileSchema.safeParse({
      name: "bad",
      requestsPerMinute: 0,
      requestsPerHour: 100,
      burstSize: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects requestsPerHour < 1", async () => {
    const { RateLimitProfileSchema } = await import("../rate-limit.js");
    const result = RateLimitProfileSchema.safeParse({
      name: "bad",
      requestsPerMinute: 10,
      requestsPerHour: 0,
      burstSize: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects burstSize < 1", async () => {
    const { RateLimitProfileSchema } = await import("../rate-limit.js");
    const result = RateLimitProfileSchema.safeParse({
      name: "bad",
      requestsPerMinute: 10,
      requestsPerHour: 100,
      burstSize: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing name field", async () => {
    const { RateLimitProfileSchema } = await import("../rate-limit.js");
    const result = RateLimitProfileSchema.safeParse({
      requestsPerMinute: 10,
    });
    expect(result.success).toBe(false);
  });
});

// ── getRateLimitStatus ────────────────────────────────────────────────────────

describe("getRateLimitStatus", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    vi.useRealTimers();
    const { closeDb } = await import("../db.js");
    closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for a key that has never been used", async () => {
    const { getRateLimitStatus } = await import("../rate-limit.js");
    const status = getRateLimitStatus("nonexistent-key");
    expect(status).toBeNull();
  });

  it("returns status after a request is made", async () => {
    const { checkRateLimit, getRateLimitStatus } = await import("../rate-limit.js");
    checkRateLimit("status-test-key", 10, 60);
    const status = getRateLimitStatus("status-test-key");
    expect(status).not.toBeNull();
    expect(status?.key).toBe("status-test-key");
    expect(status?.count).toBe(1);
    expect(status?.windowSeconds).toBe(60);
  });

  it("count reflects actual request count", async () => {
    const { checkRateLimit, getRateLimitStatus } = await import("../rate-limit.js");
    checkRateLimit("count-key", 10, 60);
    checkRateLimit("count-key", 10, 60);
    checkRateLimit("count-key", 10, 60);
    const status = getRateLimitStatus("count-key");
    expect(status?.count).toBe(3);
  });

  it("windowRemaining is positive when window is active", async () => {
    const { checkRateLimit, getRateLimitStatus } = await import("../rate-limit.js");
    checkRateLimit("window-key", 10, 60);
    const status = getRateLimitStatus("window-key");
    expect(status?.windowRemaining).toBeGreaterThan(0);
    expect(status?.windowRemaining).toBeLessThanOrEqual(60);
  });

  it("reports count=0 after window expires", async () => {
    vi.useFakeTimers();
    const { checkRateLimit, getRateLimitStatus } = await import("../rate-limit.js");
    checkRateLimit("expire-key", 5, 10);
    checkRateLimit("expire-key", 5, 10);

    // Advance past the window
    vi.advanceTimersByTime(11_000);

    const status = getRateLimitStatus("expire-key");
    // Window expired — count should read as 0
    expect(status?.count).toBe(0);
  });
});

// ── Per-client, per-agent, per-tool isolation ──────────────────────────────────

describe("rate limits: per-client, per-agent, per-tool isolation", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const { closeDb } = await import("../db.js");
    closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("per-client keys are independent", async () => {
    const { checkRateLimit } = await import("../rate-limit.js");
    checkRateLimit("client:alice", 1, 60);
    // alice is now at limit
    expect(checkRateLimit("client:alice", 1, 60)).toBe(false);
    // bob is unaffected
    expect(checkRateLimit("client:bob", 1, 60)).toBe(true);
  });

  it("per-agent keys are independent", async () => {
    const { checkRateLimit } = await import("../rate-limit.js");
    checkRateLimit("agent:gpt4:requests", 2, 60);
    checkRateLimit("agent:gpt4:requests", 2, 60);
    expect(checkRateLimit("agent:gpt4:requests", 2, 60)).toBe(false);
    expect(checkRateLimit("agent:claude:requests", 2, 60)).toBe(true);
  });

  it("per-tool keys are independent", async () => {
    const { checkRateLimit } = await import("../rate-limit.js");
    checkRateLimit("tool:bash:executions", 1, 60);
    expect(checkRateLimit("tool:bash:executions", 1, 60)).toBe(false);
    expect(checkRateLimit("tool:read_file:executions", 1, 60)).toBe(true);
  });
});

// ── checkRateLimitWithProfile ─────────────────────────────────────────────────

describe("checkRateLimitWithProfile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    vi.useRealTimers();
    const { closeDb } = await import("../db.js");
    closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("allows requests within per-minute limit", async () => {
    const { checkRateLimitWithProfile, RateLimitProfileSchema } = await import("../rate-limit.js");
    const profile = RateLimitProfileSchema.parse({
      name: "test",
      requestsPerMinute: 5,
      requestsPerHour: 100,
      burstSize: 5,
    });
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimitWithProfile("profile-test-1", profile)).toBe(true);
    }
  });

  it("blocks requests exceeding per-minute limit", async () => {
    const { checkRateLimitWithProfile, RateLimitProfileSchema } = await import("../rate-limit.js");
    const profile = RateLimitProfileSchema.parse({
      name: "tight",
      requestsPerMinute: 2,
      requestsPerHour: 100,
      burstSize: 2,
    });
    checkRateLimitWithProfile("profile-test-2", profile);
    checkRateLimitWithProfile("profile-test-2", profile);
    expect(checkRateLimitWithProfile("profile-test-2", profile)).toBe(false);
  });
});
