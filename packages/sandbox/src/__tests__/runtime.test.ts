import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  InProcessSandbox,
  InProcessRuntime,
  SandboxPool,
} from "../runtime.js";
import { AgentCapabilitiesSchema } from "../capabilities.js";
import type { SandboxRuntimeConfig } from "../runtime.js";

function makeConfig(overrides?: Partial<SandboxRuntimeConfig>): SandboxRuntimeConfig {
  return {
    capabilities: AgentCapabilitiesSchema.parse({}),
    ...overrides,
  };
}

describe("InProcessSandbox", () => {
  it("returns error JSON for unknown function", async () => {
    const sandbox = new InProcessSandbox("test-1", makeConfig());
    const result = await sandbox.call("unknown_fn", "{}");
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed.error).toContain("Unknown function");
  });

  it("calls a registered host function", async () => {
    const fn = vi.fn().mockResolvedValue(JSON.stringify({ ok: true }));
    const hostFunctions = new Map([["my_fn", fn]]);
    const sandbox = new InProcessSandbox("test-2", makeConfig({ hostFunctions }));
    const result = await sandbox.call("my_fn", "hello");
    expect(fn).toHaveBeenCalledWith("hello");
    const parsed = JSON.parse(result) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it("enforces timeout on slow host functions", async () => {
    const slowFn = () => new Promise<string>((resolve) => setTimeout(() => resolve("done"), 5000));
    const hostFunctions = new Map([["slow", slowFn]]);
    // Construct capabilities directly to use a short timeout (bypassing 1000ms minimum)
    const caps = {
      network: { allowedHosts: [] },
      filesystem: { allowedPaths: {}, readOnly: true },
      memory: { maxPages: 256 },
      tools: { allowed: ["*"], denied: [] },
      timeoutMs: 80,
    };
    const sandbox = new InProcessSandbox("test-3", { capabilities: caps, hostFunctions });
    await expect(sandbox.call("slow", "{}")).rejects.toThrow(/timed out/i);
  }, 3000);

  it("throws after close()", async () => {
    const sandbox = new InProcessSandbox("test-4", makeConfig());
    await sandbox.close();
    await expect(sandbox.call("any", "{}")).rejects.toThrow(/closed/i);
  });

  it("getMemoryUsage returns a positive number", () => {
    const sandbox = new InProcessSandbox("test-5", makeConfig());
    expect(sandbox.getMemoryUsage()).toBeGreaterThan(0);
  });

  it("reset() clears call count and throws when closed", async () => {
    const sandbox = new InProcessSandbox("test-6", makeConfig());
    await sandbox.reset();
    await sandbox.close();
    await expect(sandbox.reset()).rejects.toThrow(/closed/i);
  });
});

describe("InProcessRuntime", () => {
  it("creates a sandbox with a unique id", async () => {
    const runtime = new InProcessRuntime();
    const s1 = await runtime.create(makeConfig());
    const s2 = await runtime.create(makeConfig());
    expect(s1.id).not.toBe(s2.id);
    await s1.close();
    await s2.close();
  });
});

describe("SandboxPool", () => {
  let pool: SandboxPool;

  beforeEach(() => {
    pool = new SandboxPool({ runtime: new InProcessRuntime(), maxInstances: 3 });
  });

  afterEach(async () => {
    await pool.destroyAll();
  });

  it("creates a new sandbox on first acquire", async () => {
    const instance = await pool.acquire("agent-1", makeConfig());
    expect(instance.id).toBeTruthy();
    expect(pool.activeCount).toBe(1);
  });

  it("reuses released instances for the same agent", async () => {
    const first = await pool.acquire("agent-1", makeConfig());
    const firstId = first.id;
    await pool.release(first);
    const second = await pool.acquire("agent-1", makeConfig());
    expect(second.id).toBe(firstId);
  });

  it("creates separate instances for different agents", async () => {
    const a = await pool.acquire("agent-a", makeConfig());
    const b = await pool.acquire("agent-b", makeConfig());
    expect(a.id).not.toBe(b.id);
    expect(pool.activeCount).toBe(2);
  });

  it("throws when pool is at capacity", async () => {
    await pool.acquire("agent-1", makeConfig());
    await pool.acquire("agent-2", makeConfig());
    await pool.acquire("agent-3", makeConfig());
    await expect(pool.acquire("agent-4", makeConfig())).rejects.toThrow(/capacity/i);
  });

  it("destroyAll closes all instances and empties pool", async () => {
    await pool.acquire("agent-1", makeConfig());
    await pool.acquire("agent-2", makeConfig());
    await pool.destroyAll();
    expect(pool.totalCount).toBe(0);
    expect(pool.activeCount).toBe(0);
  });
});
