/**
 * Tests for packages/ui/src/stores/usage-actions.ts
 *
 * The gateway client and solid-js/store are fully mocked so no WebSocket
 * or reactive context is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UsageSummary } from "../gateway/types";

// ── Shim solid-js/store ───────────────────────────────────────────────────────

const storeState = {
  connection: { status: "disconnected", error: null as string | null },
  usage: { summary: null as UsageSummary | null },
};

function setStore(...args: unknown[]): void {
  if (args.length === 3) {
    const section = args[0] as keyof typeof storeState;
    const field = args[1] as string;
    const value = args[2];
    (storeState[section] as Record<string, unknown>)[field] = value;
  }
}

vi.mock("solid-js/store", () => ({
  createStore: (_initial: unknown) => [storeState, setStore],
}));

vi.mock("solid-js", () => ({
  createSignal: (initial: unknown) => {
    let val = initial;
    const getter = () => val;
    const setter = (next: unknown) => {
      val = typeof next === "function" ? (next as (v: unknown) => unknown)(val) : next;
    };
    return [getter, setter];
  },
}));

// ── Mock gateway client ────────────────────────────────────────────────────────

const mockRequest = vi.fn();

vi.mock("../gateway/client", () => ({
  createGatewayClient: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    request: mockRequest,
    onEvent: vi.fn(() => () => {}),
    connected: vi.fn(() => true),
  })),
}));

// Import modules under test AFTER mocks are set up
const {
  loadUsageSummary,
  loadUsageByModel,
  loadUsageBySession,
  loadUsageTimeSeries,
} = await import("../stores/usage-actions");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sampleSummary: UsageSummary = {
  totalTokens: 50000,
  totalCost: 1.5,
  totalRequests: 200,
  byModel: {
    "claude-sonnet-4-6": { tokens: 50000, cost: 1.5, requests: 200 },
  },
  periodStart: 1000000,
  periodEnd: 2000000,
};

function resetStore(): void {
  storeState.connection.error = null;
  storeState.usage.summary = null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("loadUsageSummary", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
  });

  it("calls usage.summary on the gateway", async () => {
    mockRequest.mockResolvedValue(sampleSummary);
    await loadUsageSummary();
    expect(mockRequest).toHaveBeenCalledWith("usage.summary", {});
  });

  it("stores summary in usage.summary", async () => {
    mockRequest.mockResolvedValue(sampleSummary);
    await loadUsageSummary();
    expect(storeState.usage.summary).toMatchObject({
      totalTokens: 50000,
      totalRequests: 200,
    });
  });

  it("returns the summary object", async () => {
    mockRequest.mockResolvedValue(sampleSummary);
    const result = await loadUsageSummary();
    expect(result).not.toBeNull();
    expect(result?.totalCost).toBeCloseTo(1.5);
  });

  it("returns null and sets connection error when request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("usage error"));
    const result = await loadUsageSummary();
    expect(result).toBeNull();
    expect(storeState.connection.error).toBe("usage error");
  });
});

describe("loadUsageByModel", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
  });

  it("calls usage.by-model on the gateway", async () => {
    mockRequest.mockResolvedValue({ models: [] });
    await loadUsageByModel();
    expect(mockRequest).toHaveBeenCalledWith("usage.by-model", {});
  });

  it("returns model usage array from payload.models", async () => {
    const models = [
      { model: "claude-sonnet-4-6", provider: "anthropic", inputTokens: 1000, outputTokens: 500, totalTokens: 1500, messageCount: 10, estimatedCostUsd: 0.02 },
      { model: "gpt-4o", provider: "openai", inputTokens: 2000, outputTokens: 1000, totalTokens: 3000, messageCount: 20, estimatedCostUsd: 0.08 },
    ];
    mockRequest.mockResolvedValue({ models });
    const result = await loadUsageByModel();
    expect(result).toHaveLength(2);
    expect(result[0].model).toBe("claude-sonnet-4-6");
    expect(result[1].provider).toBe("openai");
  });

  it("returns empty array when payload.models is absent", async () => {
    mockRequest.mockResolvedValue({});
    const result = await loadUsageByModel();
    expect(result).toEqual([]);
  });

  it("returns empty array and sets error when request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("model error"));
    const result = await loadUsageByModel();
    expect(result).toEqual([]);
    expect(storeState.connection.error).toBe("model error");
  });
});

describe("loadUsageBySession", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
  });

  it("calls usage.by-session on the gateway", async () => {
    mockRequest.mockResolvedValue({ sessions: [] });
    await loadUsageBySession();
    expect(mockRequest).toHaveBeenCalledWith("usage.by-session", {});
  });

  it("returns session usage array from payload.sessions", async () => {
    const sessions = [
      { sessionId: "s1", agentId: "default", inputTokens: 100, outputTokens: 50, totalTokens: 150, messageCount: 5 },
    ];
    mockRequest.mockResolvedValue({ sessions });
    const result = await loadUsageBySession();
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s1");
  });

  it("returns empty array when payload.sessions is absent", async () => {
    mockRequest.mockResolvedValue({});
    const result = await loadUsageBySession();
    expect(result).toEqual([]);
  });

  it("returns empty array and sets error when request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("session error"));
    const result = await loadUsageBySession();
    expect(result).toEqual([]);
    expect(storeState.connection.error).toBe("session error");
  });
});

describe("loadUsageTimeSeries", () => {
  beforeEach(() => {
    resetStore();
    mockRequest.mockReset();
  });

  it("calls usage.timeseries on the gateway", async () => {
    mockRequest.mockResolvedValue({ days: [] });
    await loadUsageTimeSeries();
    expect(mockRequest).toHaveBeenCalledWith("usage.timeseries", {});
  });

  it("returns daily usage array from payload.days", async () => {
    const days = [
      { date: "2026-03-20", inputTokens: 5000, outputTokens: 2500, totalTokens: 7500 },
      { date: "2026-03-21", inputTokens: 8000, outputTokens: 4000, totalTokens: 12000 },
    ];
    mockRequest.mockResolvedValue({ days });
    const result = await loadUsageTimeSeries();
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe("2026-03-20");
    expect(result[1].totalTokens).toBe(12000);
  });

  it("returns empty array when payload.days is absent", async () => {
    mockRequest.mockResolvedValue({});
    const result = await loadUsageTimeSeries();
    expect(result).toEqual([]);
  });

  it("returns empty array and sets error when request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("timeseries error"));
    const result = await loadUsageTimeSeries();
    expect(result).toEqual([]);
    expect(storeState.connection.error).toBe("timeseries error");
  });
});
