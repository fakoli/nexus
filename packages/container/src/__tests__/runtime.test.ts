/**
 * WasmContainer and ContainerRuntime tests — mock Extism.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WasmContainer, ContainerNotRunningError, ContainerStartError, ContainerCallTimeoutError } from "../runtime.js";
import type { ContainerConfig } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

// ── Mock Extism ───────────────────────────────────────────────────────────────

function makeMockPlugin(
  callResult: { text(): string } | null = { text: () => "ok" },
  callThrows?: string,
) {
  return {
    call: vi.fn(async () => {
      if (callThrows) throw new Error(callThrows);
      return callResult;
    }),
    getExports: vi.fn(async () => [
      { name: "run", kind: "function" },
      { name: "health", kind: "function" },
      { name: "memory", kind: "memory" },
    ] as WebAssembly.ModuleExportDescriptor[]),
    close: vi.fn(async () => undefined),
  };
}

// ── WasmContainer tests ───────────────────────────────────────────────────────

describe("WasmContainer", () => {
  const wasmBytes = new Uint8Array([0, 97, 115, 109]); // minimal wasm magic

  it("starts in created state", () => {
    const c = new WasmContainer("id1", baseConfig, wasmBytes);
    const state = c.getState();
    expect(state.status).toBe("created");
    expect(state.restartCount).toBe(0);
    expect(state.exitCode).toBeNull();
  });

  it("transitions to running state after start", async () => {
    const mockPlugin = makeMockPlugin();
    vi.doMock("@extism/extism", () => ({ createPlugin: vi.fn(async () => mockPlugin) }));

    const c = new WasmContainer("id2", baseConfig, wasmBytes);
    await c.start();
    expect(c.getState().status).toBe("running");
    expect(c.getState().startedAt).toBeDefined();
  });

  it("throws ContainerStartError when Extism fails to load", async () => {
    vi.doMock("@extism/extism", () => ({
      createPlugin: vi.fn(async () => { throw new Error("wasm compile error"); }),
    }));
    const c = new WasmContainer("id3", baseConfig, wasmBytes);
    await expect(c.start()).rejects.toThrow(ContainerStartError);
    expect(c.getState().status).toBe("failed");
  });

  it("transitions to stopped state after stop", async () => {
    const mockPlugin = makeMockPlugin();
    vi.doMock("@extism/extism", () => ({ createPlugin: vi.fn(async () => mockPlugin) }));

    const c = new WasmContainer("id4", baseConfig, wasmBytes);
    await c.start();
    await c.stop();
    expect(c.getState().status).toBe("stopped");
    expect(mockPlugin.close).toHaveBeenCalled();
  });

  it("stop is idempotent", async () => {
    const mockPlugin = makeMockPlugin();
    vi.doMock("@extism/extism", () => ({ createPlugin: vi.fn(async () => mockPlugin) }));

    const c = new WasmContainer("id5", baseConfig, wasmBytes);
    await c.start();
    await c.stop();
    await c.stop(); // second stop should not throw
    expect(c.getState().status).toBe("stopped");
  });

  it("throws ContainerNotRunningError when calling a stopped container", async () => {
    const c = new WasmContainer("id6", baseConfig, wasmBytes);
    // Created state — not running
    await expect(c.call("run", "{}")).rejects.toThrow(ContainerNotRunningError);
  });

  it("returns string output from call", async () => {
    const mockPlugin = makeMockPlugin({ text: () => '{"result":"done"}' });
    vi.doMock("@extism/extism", () => ({ createPlugin: vi.fn(async () => mockPlugin) }));

    const c = new WasmContainer("id7", baseConfig, wasmBytes);
    await c.start();
    const output = await c.call("run", '{"input":"test"}');
    expect(output).toBe('{"result":"done"}');
    expect(mockPlugin.call).toHaveBeenCalledWith("run", '{"input":"test"}', undefined);
  });

  it("returns null when plugin returns null", async () => {
    const mockPlugin = makeMockPlugin(null);
    vi.doMock("@extism/extism", () => ({ createPlugin: vi.fn(async () => mockPlugin) }));

    const c = new WasmContainer("id8", baseConfig, wasmBytes);
    await c.start();
    const output = await c.call("run", "");
    expect(output).toBeNull();
  });

  it("inspect returns exports filtered to functions", async () => {
    const mockPlugin = makeMockPlugin();
    vi.doMock("@extism/extism", () => ({ createPlugin: vi.fn(async () => mockPlugin) }));

    const c = new WasmContainer("id9", baseConfig, wasmBytes);
    await c.start();
    const inspect = await c.inspect();
    expect(inspect.exports).toContain("run");
    expect(inspect.exports).toContain("health");
    expect(inspect.exports).not.toContain("memory"); // filtered out (kind !== "function")
  });

  it("logs are returned most recent first", async () => {
    const c = new WasmContainer("id10", baseConfig, wasmBytes, 10);
    c.appendLog("stdout", "first");
    c.appendLog("stderr", "second");
    const logs = await c.logs(10);
    expect(logs[0].message).toBe("second");
    expect(logs[1].message).toBe("first");
  });

  it("log buffer is bounded by maxLogLines", async () => {
    const c = new WasmContainer("id11", baseConfig, wasmBytes, 3);
    c.appendLog("stdout", "a");
    c.appendLog("stdout", "b");
    c.appendLog("stdout", "c");
    c.appendLog("stdout", "d"); // pushes out "a"
    const logs = await c.logs(10);
    expect(logs).toHaveLength(3);
    const messages = logs.map((l) => l.message);
    expect(messages).not.toContain("a");
  });
});

// ── Volume path conversion ────────────────────────────────────────────────────

describe("volumesToAllowedPaths (via WasmContainer)", () => {
  it("maps guestPath → hostPath for Extism", async () => {
    const config: ContainerConfig = {
      ...baseConfig,
      volumes: [
        { hostPath: "/host/data", guestPath: "/data", readOnly: true },
        { hostPath: "/host/tmp", guestPath: "/tmp", readOnly: false },
      ],
    };
    let capturedOpts: Record<string, unknown> = {};
    vi.doMock("@extism/extism", () => ({
      createPlugin: vi.fn(async (_manifest: unknown, opts: unknown) => {
        capturedOpts = opts as Record<string, unknown>;
        return makeMockPlugin();
      }),
    }));

    const c = new WasmContainer("id12", config, new Uint8Array([0, 97, 115, 109]));
    await c.start();
    const paths = capturedOpts["allowedPaths"] as Record<string, string>;
    expect(paths["/data"]).toBe("/host/data");
    expect(paths["/tmp"]).toBe("/host/tmp");
  });
});
