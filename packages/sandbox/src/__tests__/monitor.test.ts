import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SandboxMonitor } from "../monitor.js";
import type { SandboxInstance } from "../runtime.js";

function makeMockInstance(id: string, memoryBytes = 100): SandboxInstance {
  return {
    id,
    call: vi.fn().mockResolvedValue("{}"),
    getMemoryUsage: vi.fn().mockReturnValue(memoryBytes),
    reset: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("SandboxMonitor", () => {
  let monitor: SandboxMonitor;

  beforeEach(() => {
    monitor = new SandboxMonitor({ checkIntervalMs: 50, maxMemoryBytes: 500 });
  });

  afterEach(() => {
    monitor.stop();
  });

  it("track() adds an instance to monitoring", () => {
    const inst = makeMockInstance("s1");
    monitor.track(inst, "agent-1");
    const metrics = monitor.getMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].instanceId).toBe("s1");
    expect(metrics[0].agentId).toBe("agent-1");
  });

  it("untrack() removes an instance", () => {
    const inst = makeMockInstance("s2");
    monitor.track(inst, "agent-1");
    monitor.untrack("s2");
    expect(monitor.getMetrics()).toHaveLength(0);
  });

  it("getMetricsFor() returns metrics for a known instance", () => {
    const inst = makeMockInstance("s3", 200);
    monitor.track(inst, "agent-2");
    const m = monitor.getMetricsFor("s3");
    expect(m).toBeDefined();
    expect(m!.memoryBytes).toBe(200);
    expect(m!.agentId).toBe("agent-2");
  });

  it("getMetricsFor() returns undefined for unknown instance", () => {
    expect(monitor.getMetricsFor("no-such")).toBeUndefined();
  });

  it("recordCall() increments callCount and updates lastCallAt", () => {
    const inst = makeMockInstance("s4");
    monitor.track(inst, "agent-3");
    const before = monitor.getMetricsFor("s4")!.callCount;
    monitor.recordCall("s4");
    expect(monitor.getMetricsFor("s4")!.callCount).toBe(before + 1);
  });

  it("start() triggers onLimitExceeded when memory exceeds max", async () => {
    const inst = makeMockInstance("s5", 1000); // 1000 > 500
    monitor.track(inst, "agent-4");

    const exceeded = vi.fn();
    monitor.start(exceeded);
    expect(monitor.isRunning).toBe(true);

    // Wait for the check interval
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(exceeded).toHaveBeenCalled();
    const call = exceeded.mock.calls[0][0] as { instanceId: string; memoryBytes: number };
    expect(call.instanceId).toBe("s5");
    expect(call.memoryBytes).toBe(1000);
  });

  it("start() does not trigger onLimitExceeded when memory is within limit", async () => {
    const inst = makeMockInstance("s6", 100); // 100 < 500
    monitor.track(inst, "agent-5");

    const exceeded = vi.fn();
    monitor.start(exceeded);

    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(exceeded).not.toHaveBeenCalled();
  });

  it("stop() halts periodic checking", () => {
    monitor.start(() => undefined);
    expect(monitor.isRunning).toBe(true);
    monitor.stop();
    expect(monitor.isRunning).toBe(false);
  });

  it("getMetrics() includes callCount from recordCall", () => {
    const inst = makeMockInstance("s7");
    monitor.track(inst, "agent-6");
    monitor.recordCall("s7");
    monitor.recordCall("s7");
    const m = monitor.getMetrics().find((x) => x.instanceId === "s7");
    expect(m?.callCount).toBe(2);
  });
});
