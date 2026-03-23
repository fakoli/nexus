import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@nexus/core", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  getDataDir: () => "/tmp/nexus-test",
}));

// Mock skills.installSkill so we don't hit the filesystem
vi.mock("../skills.js", () => ({
  installSkill: vi.fn(() => ({
    manifest: { id: "test-skill", name: "Test", version: "1.0.0", description: "t" },
    systemPrompt: "prompt",
  })),
}));

// Mock node:fs (required by skills transitive dep)
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

import {
  ClawhubConfigSchema,
  ClawhubSkillEntrySchema,
  configureClawhub,
  searchClawhubSkills,
  installClawhubSkill,
} from "../clawhub.js";

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("clawhub — ClawhubConfigSchema", () => {
  it("applies defaults for empty object", () => {
    const result = ClawhubConfigSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.registryUrl).toBe("https://clawhub.dev/api/v1");
    expect(result.apiKey).toBeUndefined();
  });

  it("accepts full config", () => {
    const result = ClawhubConfigSchema.parse({
      enabled: true,
      registryUrl: "https://custom.dev/api",
      apiKey: "sk-123",
    });
    expect(result.enabled).toBe(true);
    expect(result.apiKey).toBe("sk-123");
  });
});

describe("clawhub — ClawhubSkillEntrySchema", () => {
  it("accepts valid entry", () => {
    const result = ClawhubSkillEntrySchema.safeParse({
      id: "s1",
      name: "Skill One",
      description: "Does stuff",
      version: "1.0.0",
    });
    expect(result.success).toBe(true);
  });

  it("rejects entry missing id", () => {
    const result = ClawhubSkillEntrySchema.safeParse({
      name: "X",
      description: "x",
      version: "1.0.0",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// searchClawhubSkills
// ---------------------------------------------------------------------------

describe("clawhub — searchClawhubSkills", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when not enabled", async () => {
    configureClawhub({ enabled: false });
    const results = await searchClawhubSkills("test");
    expect(results).toEqual([]);
  });

  it("returns skills from successful search", async () => {
    configureClawhub({ enabled: true, registryUrl: "https://hub.test/api" });

    const mockSkills = [
      { id: "s1", name: "S1", description: "d1", version: "1.0.0" },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ skills: mockSkills, total: 1 }),
    }));

    const results = await searchClawhubSkills("test");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("s1");
  });

  it("throws on HTTP error", async () => {
    configureClawhub({ enabled: true, registryUrl: "https://hub.test/api" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }));

    await expect(searchClawhubSkills("fail")).rejects.toThrow("HTTP 500");
  });

  it("throws on network failure", async () => {
    configureClawhub({ enabled: true, registryUrl: "https://hub.test/api" });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    await expect(searchClawhubSkills("fail")).rejects.toThrow("Network error");
  });
});

// ---------------------------------------------------------------------------
// installClawhubSkill
// ---------------------------------------------------------------------------

describe("clawhub — installClawhubSkill", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when not enabled", async () => {
    configureClawhub({ enabled: false });
    await expect(installClawhubSkill("x")).rejects.toThrow("not enabled");
  });

  it("installs skill on success", async () => {
    configureClawhub({ enabled: true, registryUrl: "https://hub.test/api" });

    const skillContent = `---
id: remote-skill
name: Remote
version: 1.0.0
description: From hub
---
System prompt.`;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "remote-skill", content: skillContent }),
    }));

    const { installSkill } = await import("../skills.js");
    await installClawhubSkill("remote-skill");
    expect(installSkill).toHaveBeenCalledWith("remote-skill.md", skillContent);
  });
});
