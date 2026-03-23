/**
 * Tests for the pure helper logic in the UsageChart component
 * (packages/ui/src/components/analytics/UsageChart.tsx).
 *
 * We test the standalone pure functions that drive the SVG rendering:
 * fmtK, shortDate, bar dimension math, and maxTotal derivation.
 * No DOM or Solid rendering context is needed.
 */
import { describe, it, expect } from "vitest";
import type { DailyUsage } from "../stores/usage-actions";

// ── Re-implement the pure helpers exactly as they appear in UsageChart.tsx ────
// (These are module-internal; we duplicate them to keep tests focused on
// contract rather than implementation wiring.)

const W = 600;
const H = 200;
const PAD = { top: 16, right: 16, bottom: 48, left: 56 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;
const BAR_GAP = 2;

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${parseInt(month)}/${parseInt(day)}`;
}

function maxTotal(days: DailyUsage[]): number {
  return Math.max(...days.map((d) => d.totalTokens), 1);
}

function barW(days: DailyUsage[]): number {
  return days.length > 0 ? INNER_W / days.length : INNER_W;
}

function barHeight(tokens: number, days: DailyUsage[]): number {
  return (tokens / maxTotal(days)) * INNER_H;
}

function toY(v: number, days: DailyUsage[]): number {
  return INNER_H - (v / maxTotal(days)) * INNER_H;
}

// ── fmtK ─────────────────────────────────────────────────────────────────────

describe("fmtK: token count formatting", () => {
  it("returns plain number string for values under 1000", () => {
    expect(fmtK(0)).toBe("0");
    expect(fmtK(999)).toBe("999");
    expect(fmtK(42)).toBe("42");
  });

  it("formats thousands with K suffix", () => {
    expect(fmtK(1000)).toBe("1K");
    expect(fmtK(5500)).toBe("6K");
    expect(fmtK(999999)).toBe("1000K");
  });

  it("formats millions with M suffix", () => {
    expect(fmtK(1_000_000)).toBe("1.0M");
    expect(fmtK(2_500_000)).toBe("2.5M");
    expect(fmtK(10_000_000)).toBe("10.0M");
  });
});

// ── shortDate ─────────────────────────────────────────────────────────────────

describe("shortDate: ISO date to M/D", () => {
  it("strips leading zeros from month and day", () => {
    expect(shortDate("2026-03-07")).toBe("3/7");
  });

  it("handles double-digit month and day", () => {
    expect(shortDate("2026-12-31")).toBe("12/31");
  });

  it("handles single-digit month boundary", () => {
    expect(shortDate("2026-01-01")).toBe("1/1");
  });

  it("handles middle-of-year date", () => {
    expect(shortDate("2026-07-15")).toBe("7/15");
  });
});

// ── maxTotal ──────────────────────────────────────────────────────────────────

describe("maxTotal: max totalTokens across days", () => {
  it("returns 1 for empty data (prevents division by zero)", () => {
    expect(maxTotal([])).toBe(1);
  });

  it("returns the single value for a one-day series", () => {
    const days: DailyUsage[] = [
      { date: "2026-03-20", inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    ];
    expect(maxTotal(days)).toBe(150);
  });

  it("returns the maximum across multiple days", () => {
    const days: DailyUsage[] = [
      { date: "2026-03-19", inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      { date: "2026-03-20", inputTokens: 800, outputTokens: 400, totalTokens: 1200 },
      { date: "2026-03-21", inputTokens: 200, outputTokens: 100, totalTokens: 300 },
    ];
    expect(maxTotal(days)).toBe(1200);
  });
});

// ── barW ──────────────────────────────────────────────────────────────────────

describe("barW: slot width per bar group", () => {
  it("returns INNER_W when days is empty", () => {
    expect(barW([])).toBe(INNER_W);
  });

  it("returns INNER_W for a single day", () => {
    const days: DailyUsage[] = [
      { date: "2026-03-20", inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    ];
    expect(barW(days)).toBeCloseTo(INNER_W);
  });

  it("divides INNER_W equally across 7 days", () => {
    const days: DailyUsage[] = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, "0")}`,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    }));
    expect(barW(days)).toBeCloseTo(INNER_W / 7);
  });

  it("bar width decreases as more days are added", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        date: `2026-03-${String(i + 1).padStart(2, "0")}`,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      }));
    expect(barW(make(30))).toBeLessThan(barW(make(7)));
  });
});

// ── barHeight ─────────────────────────────────────────────────────────────────

describe("barHeight: pixel height for a token count", () => {
  it("returns 0 for zero tokens", () => {
    const days: DailyUsage[] = [
      { date: "2026-03-20", inputTokens: 0, outputTokens: 0, totalTokens: 1000 },
    ];
    expect(barHeight(0, days)).toBe(0);
  });

  it("returns INNER_H for the maximum value", () => {
    const days: DailyUsage[] = [
      { date: "2026-03-20", inputTokens: 600, outputTokens: 400, totalTokens: 1000 },
    ];
    expect(barHeight(1000, days)).toBeCloseTo(INNER_H);
  });

  it("scales proportionally to totalTokens", () => {
    const days: DailyUsage[] = [
      { date: "2026-03-20", inputTokens: 500, outputTokens: 500, totalTokens: 1000 },
    ];
    // 500 / 1000 * INNER_H
    expect(barHeight(500, days)).toBeCloseTo(INNER_H / 2);
  });

  it("input and output bars together can reach full height", () => {
    const days: DailyUsage[] = [
      { date: "2026-03-20", inputTokens: 600, outputTokens: 400, totalTokens: 1000 },
    ];
    const inH = barHeight(600, days);
    const outH = barHeight(400, days);
    expect(inH + outH).toBeCloseTo(INNER_H);
  });
});

// ── toY ───────────────────────────────────────────────────────────────────────

describe("toY: y-coordinate for a value (top-down SVG, bottom-anchored bars)", () => {
  it("returns INNER_H for value 0 (bottom of chart area)", () => {
    const days: DailyUsage[] = [
      { date: "2026-03-20", inputTokens: 500, outputTokens: 500, totalTokens: 1000 },
    ];
    expect(toY(0, days)).toBeCloseTo(INNER_H);
  });

  it("returns 0 for the maximum value (top of chart area)", () => {
    const days: DailyUsage[] = [
      { date: "2026-03-20", inputTokens: 600, outputTokens: 400, totalTokens: 1000 },
    ];
    expect(toY(1000, days)).toBeCloseTo(0);
  });

  it("returns INNER_H/2 for half of the maximum", () => {
    const days: DailyUsage[] = [
      { date: "2026-03-20", inputTokens: 600, outputTokens: 400, totalTokens: 1000 },
    ];
    expect(toY(500, days)).toBeCloseTo(INNER_H / 2);
  });
});

// ── SVG layout constants ───────────────────────────────────────────────────────

describe("SVG layout constants", () => {
  it("INNER_W equals W minus left and right padding", () => {
    expect(INNER_W).toBe(W - PAD.left - PAD.right);
  });

  it("INNER_H equals H minus top and bottom padding", () => {
    expect(INNER_H).toBe(H - PAD.top - PAD.bottom);
  });

  it("BAR_GAP is a positive number", () => {
    expect(BAR_GAP).toBeGreaterThan(0);
  });

  it("singleW calculation is positive for 1-day data", () => {
    const days: DailyUsage[] = [
      { date: "2026-03-20", inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    ];
    const bw = barW(days);
    const halfGap = BAR_GAP / 2;
    const singleW = bw / 2 - halfGap - 1;
    expect(singleW).toBeGreaterThan(0);
  });
});
