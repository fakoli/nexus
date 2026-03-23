import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAddMemory = vi.fn();
const mockSearchMemory = vi.fn();
const mockListMemory = vi.fn();

vi.mock("@nexus/core", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  recordAudit: vi.fn(),
  addMemory: (...args: unknown[]) => mockAddMemory(...args),
  searchMemory: (...args: unknown[]) => mockSearchMemory(...args),
  listMemory: (...args: unknown[]) => mockListMemory(...args),
}));

let registeredTool: { execute: (input: unknown) => Promise<string> };
vi.mock("../../tool-executor.js", () => ({
  registerTool: vi.fn((tool) => {
    registeredTool = tool;
  }),
}));

import { registerMemoryTool } from "../memory.js";

describe("memory tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMemoryTool();
  });

  // -- save action --

  it("saves a memory note", async () => {
    mockAddMemory.mockReturnValue({ id: "note-1", tags: [], content: "hi", createdAt: 0 });
    const result = await registeredTool.execute({
      action: "save",
      content: "Remember this fact",
      tags: ["important"],
    });
    expect(result).toContain("note-1");
    expect(mockAddMemory).toHaveBeenCalledWith("Remember this fact", "global", ["important"]);
  });

  it("save defaults tags to empty array", async () => {
    mockAddMemory.mockReturnValue({ id: "note-2", tags: [], content: "x", createdAt: 0 });
    await registeredTool.execute({ action: "save", content: "data" });
    expect(mockAddMemory).toHaveBeenCalledWith("data", "global", []);
  });

  // -- search action --

  it("searches memory notes", async () => {
    mockSearchMemory.mockReturnValue([
      { id: "n1", content: "found it", tags: ["test"], createdAt: 1000 },
    ]);
    const result = await registeredTool.execute({
      action: "search",
      query: "find me",
    });
    expect(result).toContain("found it");
    expect(mockSearchMemory).toHaveBeenCalledWith(
      expect.objectContaining({ query: "find me", limit: 20 }),
    );
  });

  it("returns no-results message for empty search", async () => {
    mockSearchMemory.mockReturnValue([]);
    const result = await registeredTool.execute({
      action: "search",
      query: "nothing",
    });
    expect(result).toContain("No memory notes found");
  });

  // -- list action --

  it("lists recent memory notes", async () => {
    mockListMemory.mockReturnValue([
      { id: "n1", content: "note one", tags: [], createdAt: 2000 },
    ]);
    const result = await registeredTool.execute({ action: "list" });
    expect(result).toContain("note one");
    expect(mockListMemory).toHaveBeenCalledWith("global", 20);
  });

  // -- invalid action --

  it("rejects invalid action", async () => {
    const result = await registeredTool.execute({ action: "delete" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  it("rejects missing action", async () => {
    const result = await registeredTool.execute({});
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  // -- error handling --

  it("returns error when core throws", async () => {
    mockAddMemory.mockImplementation(() => {
      throw new Error("DB locked");
    });
    const result = await registeredTool.execute({
      action: "save",
      content: "x",
    });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("DB locked");
  });
});
