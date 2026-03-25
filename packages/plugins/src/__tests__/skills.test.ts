import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @nexus/core before importing module under test
vi.mock("@nexus/core", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  getDataDir: () => "/tmp/nexus-test",
}));

// Mock node:fs
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

import fs from "node:fs";
import { SkillManifestSchema } from "../types.js";

// ---------------------------------------------------------------------------
// YAML frontmatter parsing (via parseSkillFile export)
// ---------------------------------------------------------------------------

const VALID_SKILL_MD = `---
id: my-skill
name: My Skill
version: 1.0.0
description: A test skill
author: tester
tags:
  - "test"
  - "demo"
---
You are a helpful assistant.`;

const MINIMAL_SKILL_MD = `---
id: minimal
name: Minimal
version: 0.1.0
description: Bare minimum
---
Do the thing.`;

describe("skills — parseSkillFile", () => {
  let parseSkillFile: typeof import("../skills.js").parseSkillFile;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../skills.js");
    parseSkillFile = mod.parseSkillFile;
  });

  it("extracts frontmatter and body from valid skill file", () => {
    const result = parseSkillFile(VALID_SKILL_MD);
    expect(result.frontmatter).toMatchObject({
      id: "my-skill",
      name: "My Skill",
      version: "1.0.0",
      description: "A test skill",
    });
    expect(result.body).toBe("You are a helpful assistant.");
  });

  it("parses tags as an array", () => {
    const result = parseSkillFile(VALID_SKILL_MD);
    expect(result.frontmatter.tags).toEqual(["test", "demo"]);
  });

  it("throws on content without frontmatter delimiters", () => {
    expect(() => parseSkillFile("no frontmatter here")).toThrow(
      "Skill file must start with YAML frontmatter",
    );
  });

  it("throws on empty string", () => {
    expect(() => parseSkillFile("")).toThrow();
  });

  it("parses minimal frontmatter", () => {
    const result = parseSkillFile(MINIMAL_SKILL_MD);
    expect(result.frontmatter.id).toBe("minimal");
    expect(result.body).toBe("Do the thing.");
  });
});

// ---------------------------------------------------------------------------
// SkillManifest Zod validation
// ---------------------------------------------------------------------------

describe("skills — SkillManifestSchema", () => {
  it("accepts a valid manifest", () => {
    const result = SkillManifestSchema.safeParse({
      id: "code-review",
      name: "Code Review",
      version: "1.0.0",
      description: "Reviews code",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const result = SkillManifestSchema.safeParse({
      name: "X",
      version: "1.0.0",
      description: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid version format", () => {
    const result = SkillManifestSchema.safeParse({
      id: "x",
      name: "X",
      version: "not-semver",
      description: "x",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional fields", () => {
    const result = SkillManifestSchema.safeParse({
      id: "x",
      name: "X",
      version: "2.0.0",
      description: "x",
      author: "tester",
      tags: ["a", "b"],
      triggers: ["/review"],
      provider: "openai",
      model: "gpt-4",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(["a", "b"]);
      expect(result.data.provider).toBe("openai");
    }
  });
});

// ---------------------------------------------------------------------------
// loadSkills / getSkill / listSkills with hierarchy
// ---------------------------------------------------------------------------

describe("skills — loadSkills hierarchy", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("workspace skills override managed skills with same id", async () => {
    const fsMock = vi.mocked(fs);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.mkdirSync.mockReturnValue(undefined as never);

    // bundled dir returns nothing
    fsMock.readdirSync.mockImplementation((dir) => {
      const d = String(dir);
      if (d.includes("bundled")) return [];
      if (d.includes("skills")) return ["s.md" as never];
      if (d.includes("nexus-skills")) return ["s.md" as never];
      return [];
    });

    let callCount = 0;
    fsMock.readFileSync.mockImplementation(() => {
      callCount++;
      // First call = managed, second = workspace
      if (callCount <= 1) {
        return MINIMAL_SKILL_MD;
      }
      return VALID_SKILL_MD;
    });

    const { loadSkills, getSkill } = await import("../skills.js");
    loadSkills();
    const skill = getSkill("my-skill");
    // workspace version should win
    expect(skill?.systemPrompt).toBe("You are a helpful assistant.");
  });
});

describe("skills — listSkills", () => {
  it("returns empty array when no skills loaded", async () => {
    vi.resetModules();
    const fsMock = vi.mocked(fs);
    fsMock.existsSync.mockReturnValue(false);
    fsMock.mkdirSync.mockReturnValue(undefined as never);
    fsMock.readdirSync.mockReturnValue([]);

    const { loadSkills, listSkills } = await import("../skills.js");
    loadSkills();
    expect(listSkills()).toEqual([]);
  });
});
