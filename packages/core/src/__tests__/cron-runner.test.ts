/**
 * Tests for core/cron-runner.ts
 *
 * computeNextRunAt is pure (no DB), so tests are straightforward.
 * startCronRunner tests verify the interval lifecycle using fake timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeNextRunAt, startCronRunner } from "../cron-runner.js";

// ── computeNextRunAt ───────────────────────────────────────────────────────

describe("computeNextRunAt: @every shorthand", () => {
  const BASE = 1_000_000; // arbitrary Unix timestamp

  it("@every 1h advances by 3600 seconds", () => {
    expect(computeNextRunAt("@every 1h", BASE)).toBe(BASE + 3600);
  });

  it("@every 30m advances by 1800 seconds", () => {
    expect(computeNextRunAt("@every 30m", BASE)).toBe(BASE + 1800);
  });

  it("@every 5m advances by 300 seconds", () => {
    expect(computeNextRunAt("@every 5m", BASE)).toBe(BASE + 300);
  });

  it("@every 90s advances by 90 seconds", () => {
    expect(computeNextRunAt("@every 90s", BASE)).toBe(BASE + 90);
  });

  it("@every 1d advances by 86400 seconds", () => {
    expect(computeNextRunAt("@every 1d", BASE)).toBe(BASE + 86400);
  });

  it("handles leading/trailing whitespace", () => {
    expect(computeNextRunAt("  @every 10m  ", BASE)).toBe(BASE + 600);
  });

  it("is case-insensitive for unit letter", () => {
    expect(computeNextRunAt("@every 2H", BASE)).toBe(BASE + 7200);
  });
});

describe("computeNextRunAt: cron expression */N minute field", () => {
  const BASE = 1_000_000;

  it("*/5 * * * * advances by 5*60 = 300 seconds", () => {
    expect(computeNextRunAt("*/5 * * * *", BASE)).toBe(BASE + 300);
  });

  it("*/15 * * * * advances by 15*60 = 900 seconds", () => {
    expect(computeNextRunAt("*/15 * * * *", BASE)).toBe(BASE + 900);
  });
});

describe("computeNextRunAt: fixed-time cron and fallback", () => {
  const BASE = 1_000_000;

  it("fixed 5-field cron (e.g. 0 9 * * *) defaults to 1-day interval", () => {
    expect(computeNextRunAt("0 9 * * *", BASE)).toBe(BASE + 86400);
  });

  it("unknown/unrecognised format defaults to 60-second interval", () => {
    expect(computeNextRunAt("not-a-cron", BASE)).toBe(BASE + 60);
  });

  it("empty string defaults to 60-second interval", () => {
    expect(computeNextRunAt("", BASE)).toBe(BASE + 60);
  });
});

// ── startCronRunner ────────────────────────────────────────────────────────

describe("startCronRunner: lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Stub getDueJobs from cron module to return empty list so no jobs run
    vi.mock("../cron.js", () => ({
      getDueJobs: vi.fn(() => []),
      updateCronJob: vi.fn(),
      recordCronRun: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns an object with a stop() function", () => {
    const runner = startCronRunner();
    expect(typeof runner.stop).toBe("function");
    runner.stop();
  });

  it("stop() can be called multiple times without throwing", () => {
    const runner = startCronRunner();
    expect(() => {
      runner.stop();
      runner.stop();
    }).not.toThrow();
  });

  it("does not throw when advancing time past one tick interval", async () => {
    const runner = startCronRunner();
    // Advance by 30 seconds to trigger the first tick
    await vi.advanceTimersByTimeAsync(30_000);
    expect(() => runner.stop()).not.toThrow();
  });

  it("does not throw when advancing through multiple tick intervals", async () => {
    const runner = startCronRunner();
    await vi.advanceTimersByTimeAsync(90_000); // 3 ticks
    expect(() => runner.stop()).not.toThrow();
  });
});
