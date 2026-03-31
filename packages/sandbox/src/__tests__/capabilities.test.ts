import { describe, it, expect } from "vitest";
import {
  AgentCapabilitiesSchema,
  NetworkCapabilitySchema,
  FilesystemCapabilitySchema,
  MemoryCapabilitySchema,
  ToolCapabilitySchema,
  CAPABILITY_PROFILES,
  isToolAllowed,
  isHostAllowed,
} from "../capabilities.js";

describe("NetworkCapabilitySchema", () => {
  it("defaults to empty allowedHosts", () => {
    const result = NetworkCapabilitySchema.parse({});
    expect(result.allowedHosts).toEqual([]);
  });

  it("accepts an explicit host list", () => {
    const result = NetworkCapabilitySchema.parse({ allowedHosts: ["api.openai.com"] });
    expect(result.allowedHosts).toContain("api.openai.com");
  });
});

describe("FilesystemCapabilitySchema", () => {
  it("defaults to empty allowedPaths and readOnly=true", () => {
    const result = FilesystemCapabilitySchema.parse({});
    expect(result.allowedPaths).toEqual({});
    expect(result.readOnly).toBe(true);
  });
});

describe("MemoryCapabilitySchema", () => {
  it("defaults to 256 pages", () => {
    const result = MemoryCapabilitySchema.parse({});
    expect(result.maxPages).toBe(256);
  });

  it("rejects maxPages < 1", () => {
    expect(() => MemoryCapabilitySchema.parse({ maxPages: 0 })).toThrow();
  });
});

describe("ToolCapabilitySchema", () => {
  it("defaults allowed=[*] and denied=[]", () => {
    const result = ToolCapabilitySchema.parse({});
    expect(result.allowed).toContain("*");
    expect(result.denied).toEqual([]);
  });
});

describe("AgentCapabilitiesSchema", () => {
  it("parses with all defaults", () => {
    const result = AgentCapabilitiesSchema.parse({});
    expect(result.timeoutMs).toBe(30000);
    expect(result.network.allowedHosts).toEqual([]);
    expect(result.tools.allowed).toContain("*");
  });

  it("rejects timeoutMs < 1000", () => {
    expect(() => AgentCapabilitiesSchema.parse({ timeoutMs: 500 })).toThrow();
  });

  it("round-trips complex config", () => {
    const input = {
      network: { allowedHosts: ["example.com"] },
      filesystem: { allowedPaths: { "/tmp": "/sandbox/tmp" }, readOnly: false },
      memory: { maxPages: 128 },
      tools: { allowed: ["memory"], denied: ["web_fetch"] },
      timeoutMs: 15000,
    };
    const result = AgentCapabilitiesSchema.parse(input);
    expect(result.network.allowedHosts).toEqual(["example.com"]);
    expect(result.filesystem.allowedPaths["/tmp"]).toBe("/sandbox/tmp");
    expect(result.filesystem.readOnly).toBe(false);
    expect(result.memory.maxPages).toBe(128);
    expect(result.tools.allowed).toContain("memory");
    expect(result.tools.denied).toContain("web_fetch");
    expect(result.timeoutMs).toBe(15000);
  });
});

describe("CAPABILITY_PROFILES", () => {
  it("minimal: tools are all denied", () => {
    const caps = CAPABILITY_PROFILES.minimal;
    expect(caps.tools.denied).toContain("*");
    expect(caps.network.allowedHosts).toEqual([]);
  });

  it("standard: only specific tools allowed", () => {
    const caps = CAPABILITY_PROFILES.standard;
    expect(caps.tools.allowed).toContain("memory");
    expect(caps.tools.allowed).toContain("web_search");
  });

  it("trusted: all tools allowed, no denials", () => {
    const caps = CAPABILITY_PROFILES.trusted;
    expect(caps.tools.allowed).toContain("*");
    expect(caps.tools.denied).toEqual([]);
    expect(caps.network.allowedHosts).toContain("*");
  });
});

describe("isToolAllowed", () => {
  it("allows any tool when allowed=[*]", () => {
    const caps = AgentCapabilitiesSchema.parse({});
    expect(isToolAllowed(caps, "web_fetch")).toBe(true);
  });

  it("blocks any tool when denied=[*]", () => {
    const caps = CAPABILITY_PROFILES.minimal;
    expect(isToolAllowed(caps, "memory")).toBe(false);
  });

  it("blocks a specifically denied tool", () => {
    const caps = AgentCapabilitiesSchema.parse({
      tools: { allowed: ["*"], denied: ["web_fetch"] },
    });
    expect(isToolAllowed(caps, "web_fetch")).toBe(false);
    expect(isToolAllowed(caps, "memory")).toBe(true);
  });

  it("allows a specifically named tool", () => {
    const caps = AgentCapabilitiesSchema.parse({
      tools: { allowed: ["memory"], denied: [] },
    });
    expect(isToolAllowed(caps, "memory")).toBe(true);
    expect(isToolAllowed(caps, "web_fetch")).toBe(false);
  });

  it("deny takes precedence over allow", () => {
    const caps = AgentCapabilitiesSchema.parse({
      tools: { allowed: ["memory"], denied: ["memory"] },
    });
    expect(isToolAllowed(caps, "memory")).toBe(false);
  });
});

describe("isHostAllowed", () => {
  it("allows any host when allowedHosts=[*]", () => {
    const caps = CAPABILITY_PROFILES.trusted;
    expect(isHostAllowed(caps, "anything.com")).toBe(true);
  });

  it("blocks a host not in the list", () => {
    const caps = CAPABILITY_PROFILES.standard;
    expect(isHostAllowed(caps, "evil.com")).toBe(false);
  });

  it("allows a host that is in the list", () => {
    const caps = CAPABILITY_PROFILES.standard;
    expect(isHostAllowed(caps, "api.openai.com")).toBe(true);
  });

  it("blocks all hosts when allowedHosts=[]", () => {
    const caps = CAPABILITY_PROFILES.minimal;
    expect(isHostAllowed(caps, "api.openai.com")).toBe(false);
  });
});
