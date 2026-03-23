import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @nexus/core
vi.mock("@nexus/core", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock @nexus/plugins
const mockListSkills = vi.fn();
const mockLoadSkills = vi.fn();
const mockSearchClawhubSkills = vi.fn();
const mockInstallClawhubSkill = vi.fn();

vi.mock("@nexus/plugins", () => ({
  listSkills: (...args: unknown[]) => mockListSkills(...args),
  loadSkills: (...args: unknown[]) => mockLoadSkills(...args),
  searchClawhubSkills: (...args: unknown[]) => mockSearchClawhubSkills(...args),
  installClawhubSkill: (...args: unknown[]) => mockInstallClawhubSkill(...args),
}));

import {
  handleSkillsList,
  handleSkillsSearch,
} from "../skills.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleSkillsList", () => {
  it("returns skills when already loaded", () => {
    const skills = [
      {
        manifest: {
          id: "skill-1",
          name: "Skill One",
          version: "1.0.0",
          description: "A test skill",
          author: "test",
          tags: ["utility"],
          triggers: ["/skill1"],
        },
      },
    ];
    mockListSkills.mockReturnValue(skills);

    const result = handleSkillsList();
    expect(result.ok).toBe(true);
    expect(result.payload?.skills).toHaveLength(1);
    expect(result.payload?.skills[0].id).toBe("skill-1");
    expect(result.payload?.skills[0].name).toBe("Skill One");
    expect(mockLoadSkills).not.toHaveBeenCalled();
  });

  it("loads skills when list is empty", () => {
    mockListSkills.mockReturnValue([]);
    mockLoadSkills.mockReturnValue([
      {
        manifest: {
          id: "auto-loaded",
          name: "Auto",
          version: "0.1.0",
          description: "Auto-loaded",
          author: "system",
          tags: [],
          triggers: [],
        },
      },
    ]);

    const result = handleSkillsList();
    expect(result.ok).toBe(true);
    expect(mockLoadSkills).toHaveBeenCalled();
    expect(result.payload?.skills).toHaveLength(1);
    expect(result.payload?.skills[0].id).toBe("auto-loaded");
  });

  it("maps manifest fields correctly", () => {
    const skills = [
      {
        manifest: {
          id: "s1",
          name: "N",
          version: "2.0.0",
          description: "Desc",
          author: "A",
          tags: ["a", "b"],
          triggers: ["/cmd"],
        },
      },
    ];
    mockListSkills.mockReturnValue(skills);

    const result = handleSkillsList();
    const skill = result.payload?.skills[0];
    expect(skill).toEqual({
      id: "s1",
      name: "N",
      version: "2.0.0",
      description: "Desc",
      author: "A",
      tags: ["a", "b"],
      triggers: ["/cmd"],
    });
  });
});

describe("handleSkillsSearch", () => {
  it("accepts empty query (default)", async () => {
    mockSearchClawhubSkills.mockResolvedValue([]);
    const result = await handleSkillsSearch({});
    expect(result.ok).toBe(true);
    expect(result.payload?.results).toEqual([]);
    expect(mockSearchClawhubSkills).toHaveBeenCalledWith("");
  });

  it("passes query to search function", async () => {
    const results = [{ id: "s1", name: "Skill 1" }];
    mockSearchClawhubSkills.mockResolvedValue(results);

    const result = await handleSkillsSearch({ query: "code" });
    expect(result.ok).toBe(true);
    expect(result.payload?.results).toEqual(results);
    expect(mockSearchClawhubSkills).toHaveBeenCalledWith("code");
  });

  it("returns SKILL_SEARCH_FAILED on error", async () => {
    mockSearchClawhubSkills.mockRejectedValue(new Error("Network error"));
    const result = await handleSkillsSearch({ query: "x" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("SKILL_SEARCH_FAILED");
  });
});
