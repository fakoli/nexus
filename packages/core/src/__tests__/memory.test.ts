import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-memory-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import("../db.js");
  db.closeDb();
  db.runMigrations();
  return db;
}

describe("memory module", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const db = await import("../db.js");
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("addMemory creates a note with auto-generated id", async () => {
    const { addMemory } = await import("../memory.js");
    const note = addMemory("Remember this fact");
    expect(note.id).toBeTruthy();
    expect(note.content).toBe("Remember this fact");
    expect(note.scope).toBe("global");
    expect(note.tags).toEqual([]);
  });

  it("addMemory stores tags correctly", async () => {
    const { addMemory } = await import("../memory.js");
    const note = addMemory("Tagged note", "global", ["important", "test"]);
    expect(note.tags).toEqual(["important", "test"]);
  });

  it("addMemory supports custom scopes", async () => {
    const { addMemory } = await import("../memory.js");
    const note = addMemory("Agent-scoped note", "agent:my-agent");
    expect(note.scope).toBe("agent:my-agent");
  });

  it("getMemory retrieves a note by id", async () => {
    const { addMemory, getMemory } = await import("../memory.js");
    const created = addMemory("Find me");
    const found = getMemory(created.id);
    expect(found).not.toBeNull();
    expect(found?.content).toBe("Find me");
  });

  it("getMemory returns null for non-existent id", async () => {
    const { getMemory } = await import("../memory.js");
    expect(getMemory("non-existent")).toBeNull();
  });

  it("updateMemory modifies content", async () => {
    const { addMemory, updateMemory } = await import("../memory.js");
    const note = addMemory("Old content");
    const updated = updateMemory(note.id, { content: "New content" });
    expect(updated?.content).toBe("New content");
  });

  it("updateMemory modifies tags", async () => {
    const { addMemory, updateMemory } = await import("../memory.js");
    const note = addMemory("Note", "global", ["old"]);
    const updated = updateMemory(note.id, { tags: ["new", "updated"] });
    expect(updated?.tags).toEqual(["new", "updated"]);
  });

  it("updateMemory returns null for non-existent id", async () => {
    const { updateMemory } = await import("../memory.js");
    expect(updateMemory("non-existent", { content: "x" })).toBeNull();
  });

  it("deleteMemory removes a note", async () => {
    const { addMemory, deleteMemory, getMemory } = await import("../memory.js");
    const note = addMemory("Delete me");
    expect(deleteMemory(note.id)).toBe(true);
    expect(getMemory(note.id)).toBeNull();
  });

  it("deleteMemory returns false for non-existent id", async () => {
    const { deleteMemory } = await import("../memory.js");
    expect(deleteMemory("non-existent")).toBe(false);
  });

  it("listMemory returns notes for a scope", async () => {
    const { addMemory, listMemory } = await import("../memory.js");
    addMemory("Note 1", "test-scope");
    addMemory("Note 2", "test-scope");
    addMemory("Note 3", "other-scope");
    const notes = listMemory("test-scope");
    expect(notes).toHaveLength(2);
  });

  it("listMemory respects limit", async () => {
    const { addMemory, listMemory } = await import("../memory.js");
    for (let i = 0; i < 5; i++) {
      addMemory(`Note ${i}`, "global");
    }
    const notes = listMemory("global", 3);
    expect(notes).toHaveLength(3);
  });

  it("searchMemory filters by scope", async () => {
    const { addMemory, searchMemory } = await import("../memory.js");
    addMemory("A", "scope-a");
    addMemory("B", "scope-b");
    const results = searchMemory({ scope: "scope-a" });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("A");
  });

  it("searchMemory filters by tags", async () => {
    const { addMemory, searchMemory } = await import("../memory.js");
    addMemory("Tagged", "global", ["important"]);
    addMemory("Untagged", "global");
    const results = searchMemory({ tags: ["important"] });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Tagged");
  });

  it("searchMemory filters by query string", async () => {
    const { addMemory, searchMemory } = await import("../memory.js");
    addMemory("The quick brown fox");
    addMemory("A lazy dog");
    const results = searchMemory({ query: "brown fox" });
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("brown fox");
  });

  it("countMemory returns total count", async () => {
    const { addMemory, countMemory } = await import("../memory.js");
    addMemory("One");
    addMemory("Two");
    expect(countMemory()).toBe(2);
  });

  it("countMemory filters by scope", async () => {
    const { addMemory, countMemory } = await import("../memory.js");
    addMemory("A", "scope-a");
    addMemory("B", "scope-a");
    addMemory("C", "scope-b");
    expect(countMemory("scope-a")).toBe(2);
    expect(countMemory("scope-b")).toBe(1);
  });
});
