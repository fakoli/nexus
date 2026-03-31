/**
 * LifecycleManager tests — health checks, restart policies, state transitions, events.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LifecycleManager } from "../lifecycle.js";
import { events } from "@nexus/core";
import type { ContainerConfig } from "../types.js";

// ── Base config ────────────────────────────────────────────────────────────

const baseConfig: ContainerConfig = {
  image: "ghcr.io/org/test:latest",
  env: {},
  volumes: [],
  allowedHosts: [],
  memoryLimitPages: 256,
  timeoutMs: 30000,
  restartPolicy: { mode: "never" },
  auth: { kind: "anonymous" },
  pluginConfig: {},
};

// ── Mock ContainerRuntime and WasmContainer ────────────────────────────────

// We need to mock the runtime module to avoid real OCI pulls
vi.mock("../runtime.js", async () => {
  const actual = await vi.importActual("../runtime.js") as Record<string, unknown>;

  class MockWasmContainer {
    readonly id: string;
    readonly config: ContainerConfig;
    private _state: Record<string, unknown>;
    private _logs: Array<{ timestamp: string; stream: string; message: string }> = [];
    public callFn: (name: string, input: string) => Promise<string | null> = async () => "healthy";

    constructor(id: string, config: ContainerConfig) {
      this.id = id;
      this.config = config;
      this._state = { status: "created", restartCount: 0, exitCode: null };
    }

    async start() {
      this._state = { ...this._state, status: "running", startedAt: new Date().toISOString() };
    }
    async stop() {
      this._state = { ...this._state, status: "stopped", stoppedAt: new Date().toISOString() };
    }
    async restart() {
      await this.stop();
      this._state = { ...this._state, status: "created" };
      await this.start();
    }
    async call(name: string, input: string) {
      return this.callFn(name, input);
    }
    async inspect() {
      return { id: this.id, config: this.config, exports: ["run", "health"], state: this._state };
    }
    async logs(limit = 100) {
      return this._logs.slice(-limit).reverse();
    }
    async stats() {
      return { containerId: this.id, memoryUsageBytes: 0, callCount: 0, uptimeMs: 0, sampledAt: new Date().toISOString() };
    }
    getState() { return this._state as import("../types.js").ContainerState; }
    setState(patch: Record<string, unknown>) { this._state = { ...this._state, ...patch }; }
    appendLog(stream: string, message: string) {
      this._logs.push({ timestamp: new Date().toISOString(), stream, message });
    }
  }

  class MockContainerRuntime {
    private containers = new Map<string, MockWasmContainer>();
    private idCounter = 0;

    async create(config: ContainerConfig) {
      const id = `mock-${++this.idCounter}`;
      const c = new MockWasmContainer(id, config);
      this.containers.set(id, c);
      return c;
    }
    get(id: string) { return this.containers.get(id); }
    list() { return Array.from(this.containers.values()); }
    async remove(id: string) {
      const c = this.containers.get(id);
      if (!c) throw new (actual["ContainerNotFoundError"] as new (id: string) => Error)(id);
      await c.stop();
      this.containers.delete(id);
    }
  }

  return {
    ...actual,
    ContainerRuntime: MockContainerRuntime,
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LifecycleManager", () => {
  let manager: LifecycleManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new LifecycleManager({ maxLogLines: 100 });
  });

  afterEach(async () => {
    await manager.shutdown();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("starts a container and returns its ID and state", async () => {
    const result = await manager.start(baseConfig);
    expect(result.containerId).toBeTruthy();
    expect(result.state.status).toBe("running");
  });

  it("lists container IDs after start", async () => {
    const r1 = await manager.start(baseConfig);
    const r2 = await manager.start(baseConfig);
    const ids = manager.listContainerIds();
    expect(ids).toContain(r1.containerId);
    expect(ids).toContain(r2.containerId);
    expect(ids).toHaveLength(2);
  });

  it("getState returns current state", async () => {
    const { containerId } = await manager.start(baseConfig);
    const state = manager.getState(containerId);
    expect(state.status).toBe("running");
  });

  it("stop transitions to stopped and removes from supervision", async () => {
    const { containerId } = await manager.start(baseConfig);
    await manager.stop(containerId);
    expect(manager.listContainerIds()).not.toContain(containerId);
  });

  it("call delegates to the container", async () => {
    const { containerId } = await manager.start(baseConfig);
    const entry = manager.getManagedEntry(containerId);
    expect(entry).toBeDefined();

    // Patch the call method on the underlying container
    if (entry) {
      (entry.container as unknown as { callFn: (n: string, i: string) => Promise<string | null> }).callFn =
        async () => "response";
    }

    const result = await manager.call(containerId, "run", "{}");
    expect(result).toBe("response");
  });

  it("getLogs returns captured log lines", async () => {
    const { containerId } = await manager.start(baseConfig);
    const entry = manager.getManagedEntry(containerId);
    entry?.container.appendLog("stdout", "hello");
    const logs = await manager.getLogs(containerId, 10);
    expect(logs.some((l) => l.message === "hello")).toBe(true);
  });

  it("shutdown stops all containers", async () => {
    const r1 = await manager.start(baseConfig);
    const r2 = await manager.start(baseConfig);
    await manager.shutdown();
    expect(manager.listContainerIds()).toHaveLength(0);

    // After shutdown these IDs are gone
    expect(manager.getManagedEntry(r1.containerId)).toBeUndefined();
    expect(manager.getManagedEntry(r2.containerId)).toBeUndefined();
  });

  it("emits container:started event", async () => {
    const handler = vi.fn();
    events.on("container:started", handler);
    const { containerId } = await manager.start(baseConfig);
    events.off("container:started", handler);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ containerId, image: baseConfig.image }),
    );
  });

  it("emits container:stopped event on stop", async () => {
    const handler = vi.fn();
    events.on("container:stopped", handler);
    const { containerId } = await manager.start(baseConfig);
    await manager.stop(containerId);
    events.off("container:stopped", handler);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ containerId }),
    );
  });
});

// ── Health check tests ────────────────────────────────────────────────────────

describe("LifecycleManager health checks", () => {
  let manager: LifecycleManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new LifecycleManager({ maxLogLines: 100 });
  });

  afterEach(async () => {
    await manager.shutdown();
    vi.useRealTimers();
  });

  it("schedules health checks when healthCheck config is present", async () => {
    const config: ContainerConfig = {
      ...baseConfig,
      healthCheck: { functionName: "health", intervalMs: 5000, timeoutMs: 1000, retries: 3, startPeriodMs: 0 },
    };
    const { containerId } = await manager.start(config);
    const entry = manager.getManagedEntry(containerId);
    expect(entry?.healthIntervalHandle).toBeDefined();
  });

  it("returns undefined health state for containers without health check", async () => {
    const { containerId } = await manager.start(baseConfig);
    expect(manager.getHealthState(containerId)).toBeUndefined();
  });

  it("initialises health state for containers with health check", async () => {
    const config: ContainerConfig = {
      ...baseConfig,
      healthCheck: { functionName: "health", intervalMs: 5000, timeoutMs: 1000, retries: 3, startPeriodMs: 0 },
    };
    const { containerId } = await manager.start(config);
    const healthState = manager.getHealthState(containerId);
    expect(healthState).toBeDefined();
    expect(healthState?.consecutiveFailures).toBe(0);
    expect(healthState?.containerId).toBe(containerId);
  });
});
