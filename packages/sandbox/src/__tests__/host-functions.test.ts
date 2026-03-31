import { describe, it, expect, vi } from "vitest";
import { createHostFunctions } from "../host-functions.js";
import { AgentCapabilitiesSchema, CAPABILITY_PROFILES } from "../capabilities.js";

const baseOptions = {
  agentId: "test-agent",
  sessionId: "test-session",
};

describe("createHostFunctions — tool_execute", () => {
  it("returns error for invalid JSON input", async () => {
    const caps = AgentCapabilitiesSchema.parse({});
    const fns = createHostFunctions({ ...baseOptions, capabilities: caps });
    const fn = fns.get("tool_execute");
    expect(fn).toBeDefined();
    const result = await fn!("not-json");
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed.error).toContain("Invalid tool_execute input");
  });

  it("returns error for missing required fields", async () => {
    const caps = AgentCapabilitiesSchema.parse({});
    const fns = createHostFunctions({ ...baseOptions, capabilities: caps });
    const fn = fns.get("tool_execute");
    const result = await fn!(JSON.stringify({ name: "memory" })); // missing input
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed.error).toContain("Invalid tool_execute input");
  });

  it("blocks a tool denied by capabilities", async () => {
    const caps = CAPABILITY_PROFILES.minimal; // denied: ["*"]
    const fns = createHostFunctions({ ...baseOptions, capabilities: caps });
    const fn = fns.get("tool_execute");
    const result = await fn!(JSON.stringify({ name: "web_fetch", input: {} }));
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed.error).toContain("not permitted");
  });

  it("calls toolExecutor when tool is allowed", async () => {
    const caps = AgentCapabilitiesSchema.parse({});
    const toolExecutor = vi.fn().mockResolvedValue(JSON.stringify({ answer: 42 }));
    const fns = createHostFunctions({ ...baseOptions, capabilities: caps, toolExecutor });
    const fn = fns.get("tool_execute");
    const result = await fn!(JSON.stringify({ name: "memory", input: { query: "test" } }));
    expect(toolExecutor).toHaveBeenCalledWith("memory", { query: "test" });
    const parsed = JSON.parse(result) as { answer: number };
    expect(parsed.answer).toBe(42);
  });

  it("returns stub result when no toolExecutor is provided", async () => {
    const caps = AgentCapabilitiesSchema.parse({});
    const fns = createHostFunctions({ ...baseOptions, capabilities: caps });
    const fn = fns.get("tool_execute");
    const result = await fn!(JSON.stringify({ name: "memory", input: {} }));
    const parsed = JSON.parse(result) as { result: string };
    expect(parsed.result).toContain("stub");
  });
});

describe("createHostFunctions — memory_search", () => {
  it("returns error for invalid input", async () => {
    const caps = AgentCapabilitiesSchema.parse({});
    const fns = createHostFunctions({ ...baseOptions, capabilities: caps });
    const fn = fns.get("memory_search");
    const result = await fn!(JSON.stringify({ bad: "field" }));
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed.error).toContain("Invalid memory_search input");
  });

  it("returns stub results for valid input", async () => {
    const caps = AgentCapabilitiesSchema.parse({});
    const fns = createHostFunctions({ ...baseOptions, capabilities: caps });
    const fn = fns.get("memory_search");
    const result = await fn!(JSON.stringify({ query: "hello" }));
    const parsed = JSON.parse(result) as { results: unknown[]; query: string };
    expect(parsed.results).toEqual([]);
    expect(parsed.query).toBe("hello");
  });
});

describe("createHostFunctions — log", () => {
  it("returns ok for valid input", async () => {
    const caps = AgentCapabilitiesSchema.parse({});
    const fns = createHostFunctions({ ...baseOptions, capabilities: caps });
    const fn = fns.get("log");
    const result = await fn!(JSON.stringify({ level: "info", message: "hello" }));
    const parsed = JSON.parse(result) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it("returns error for invalid level", async () => {
    const caps = AgentCapabilitiesSchema.parse({});
    const fns = createHostFunctions({ ...baseOptions, capabilities: caps });
    const fn = fns.get("log");
    const result = await fn!(JSON.stringify({ level: "verbose", message: "hi" }));
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed.error).toContain("Invalid log input");
  });
});

describe("createHostFunctions — registered functions", () => {
  it("registers tool_execute, memory_search, and log", () => {
    const caps = AgentCapabilitiesSchema.parse({});
    const fns = createHostFunctions({ ...baseOptions, capabilities: caps });
    expect(fns.has("tool_execute")).toBe(true);
    expect(fns.has("memory_search")).toBe(true);
    expect(fns.has("log")).toBe(true);
  });
});
