/**
 * Container RPC handler tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleContainerList, handleContainerStop, handleContainerLogs, handleContainerRemove } from "../handlers/container.js";

// ── Mock the container package ────────────────────────────────────────────────

vi.mock("@nexus/container", async () => {
  const mockManager = {
    start: vi.fn(async () => ({ containerId: "mock-id", state: { status: "running" } })),
    stop: vi.fn(async () => undefined),
    listContainerIds: vi.fn(() => ["mock-id"]),
    getState: vi.fn(() => ({ status: "running", restartCount: 0, exitCode: null })),
    getHealthState: vi.fn(() => undefined),
    getLogs: vi.fn(async () => [{ timestamp: "2026-01-01T00:00:00Z", stream: "stdout", message: "hello" }]),
    getManagedEntry: vi.fn((id: string) => id === "mock-id" ? { container: { inspect: async () => ({ id, exports: ["run"], state: { status: "running" } }) } } : undefined),
    shutdown: vi.fn(async () => undefined),
  };

  return {
    LifecycleManager: vi.fn(() => mockManager),
    ContainerConfigSchema: {
      safeParse: (data: unknown) => {
        const d = data as Record<string, unknown>;
        if (!d["image"]) return { success: false, error: { message: "image required" } };
        return {
          success: true,
          data: {
            image: d["image"],
            env: {},
            volumes: [],
            allowedHosts: [],
            memoryLimitPages: 256,
            timeoutMs: 30000,
            restartPolicy: { mode: "never" },
            auth: { kind: "anonymous" },
            pluginConfig: {},
          },
        };
      },
    },
    parseImageRef: (ref: string) => {
      if (!ref) throw new Error("Empty ref");
      return { registry: "ghcr.io", repository: "org/test", reference: "latest", original: ref };
    },
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleContainerList", () => {
  it("returns list of containers", () => {
    const result = handleContainerList({});
    expect(result.ok).toBe(true);
    if (result.ok && result.payload) {
      const payload = result.payload as { count: number; containers: unknown[] };
      expect(payload.count).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("handleContainerStop", () => {
  it("returns INVALID_PARAMS when containerId is missing", async () => {
    const result = await handleContainerStop({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("stops container when ID is valid", async () => {
    const result = await handleContainerStop({ containerId: "mock-id" });
    expect(result.ok).toBe(true);
  });
});

describe("handleContainerLogs", () => {
  it("returns INVALID_PARAMS when containerId is missing", async () => {
    const result = await handleContainerLogs({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns logs for valid containerId", async () => {
    const result = await handleContainerLogs({ containerId: "mock-id" });
    expect(result.ok).toBe(true);
    if (result.ok && result.payload) {
      const payload = result.payload as { logs: unknown[]; count: number };
      expect(Array.isArray(payload.logs)).toBe(true);
    }
  });
});

describe("handleContainerRemove", () => {
  it("returns INVALID_PARAMS when containerId is missing", async () => {
    const result = await handleContainerRemove({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("removes container when ID is valid", async () => {
    const result = await handleContainerRemove({ containerId: "mock-id" });
    expect(result.ok).toBe(true);
  });
});
