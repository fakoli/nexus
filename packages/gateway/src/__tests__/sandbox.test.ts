/**
 * Tests for gateway/handlers/sandbox.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import { handleSandboxStatus, handleSandboxList } from "../handlers/sandbox.js";

describe("handleSandboxStatus", () => {
  it("returns ok:true with a sandboxes array", () => {
    const response = handleSandboxStatus({});
    expect(response.ok).toBe(true);
    expect(response.payload).toBeDefined();
    const payload = response.payload as {
      sandboxes: unknown[];
      activeCount: number;
      totalCount: number;
      monitorRunning: boolean;
    };
    expect(Array.isArray(payload.sandboxes)).toBe(true);
    expect(typeof payload.activeCount).toBe("number");
    expect(typeof payload.totalCount).toBe("number");
    expect(typeof payload.monitorRunning).toBe("boolean");
  });

  it("accepts optional agentId filter", () => {
    const response = handleSandboxStatus({ agentId: "some-agent" });
    expect(response.ok).toBe(true);
  });

  it("returns INVALID_PARAMS for a non-string agentId", () => {
    const response = handleSandboxStatus({ agentId: 123 });
    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("handleSandboxList", () => {
  it("returns ok:true with profiles array", () => {
    const response = handleSandboxList({});
    expect(response.ok).toBe(true);
    const payload = response.payload as {
      profiles: Array<{ name: string; capabilities: unknown }>;
      activeCount: number;
      agentId: null | string;
    };
    expect(Array.isArray(payload.profiles)).toBe(true);
    expect(payload.profiles.length).toBeGreaterThan(0);
    expect(payload.agentId).toBeNull();
  });

  it("includes minimal, standard and trusted profiles", () => {
    const response = handleSandboxList({});
    const payload = response.payload as { profiles: Array<{ name: string }> };
    const names = payload.profiles.map((p) => p.name);
    expect(names).toContain("minimal");
    expect(names).toContain("standard");
    expect(names).toContain("trusted");
  });

  it("reflects the agentId filter in the response", () => {
    const response = handleSandboxList({ agentId: "my-agent" });
    expect(response.ok).toBe(true);
    const payload = response.payload as { agentId: string };
    expect(payload.agentId).toBe("my-agent");
  });

  it("returns INVALID_PARAMS for invalid agentId type", () => {
    const response = handleSandboxList({ agentId: 42 });
    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("INVALID_PARAMS");
  });
});
