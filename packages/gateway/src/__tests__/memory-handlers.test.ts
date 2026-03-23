import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-memory-handler-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import("@nexus/core");
  db.closeDb();
  db.runMigrations();
  return db;
}

describe("memory RPC handlers", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const db = await import("@nexus/core");
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("memory.add creates a note and returns it", async () => {
    const { handleMemoryAdd } = await import("../handlers/memory.js");
    const result = handleMemoryAdd({ content: "Test note", scope: "global", tags: ["test"] });
    expect(result.ok).toBe(true);
    expect(result.payload).toHaveProperty("id");
    expect(result.payload).toHaveProperty("content", "Test note");
  });

  it("memory.add returns error for missing content", async () => {
    const { handleMemoryAdd } = await import("../handlers/memory.js");
    const result = handleMemoryAdd({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("memory.get retrieves a note", async () => {
    const { handleMemoryAdd, handleMemoryGet } = await import("../handlers/memory.js");
    const addResult = handleMemoryAdd({ content: "Find this" });
    const id = (addResult.payload as { id: string }).id;
    const getResult = handleMemoryGet({ id });
    expect(getResult.ok).toBe(true);
    expect(getResult.payload).toHaveProperty("content", "Find this");
  });

  it("memory.get returns NOT_FOUND for missing note", async () => {
    const { handleMemoryGet } = await import("../handlers/memory.js");
    const result = handleMemoryGet({ id: "does-not-exist" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("memory.update modifies a note", async () => {
    const { handleMemoryAdd, handleMemoryUpdate } = await import("../handlers/memory.js");
    const addResult = handleMemoryAdd({ content: "Original" });
    const id = (addResult.payload as { id: string }).id;
    const updateResult = handleMemoryUpdate({ id, content: "Updated" });
    expect(updateResult.ok).toBe(true);
    expect(updateResult.payload).toHaveProperty("content", "Updated");
  });

  it("memory.delete removes a note", async () => {
    const { handleMemoryAdd, handleMemoryDelete, handleMemoryGet } = await import("../handlers/memory.js");
    const addResult = handleMemoryAdd({ content: "Delete me" });
    const id = (addResult.payload as { id: string }).id;
    const deleteResult = handleMemoryDelete({ id });
    expect(deleteResult.ok).toBe(true);
    const getResult = handleMemoryGet({ id });
    expect(getResult.ok).toBe(false);
  });

  it("memory.search finds notes by scope", async () => {
    const { handleMemoryAdd, handleMemorySearch } = await import("../handlers/memory.js");
    handleMemoryAdd({ content: "A", scope: "test-scope" });
    handleMemoryAdd({ content: "B", scope: "test-scope" });
    handleMemoryAdd({ content: "C", scope: "other-scope" });
    const result = handleMemorySearch({ scope: "test-scope" });
    expect(result.ok).toBe(true);
    const payload = result.payload as { notes: unknown[]; count: number };
    expect(payload.count).toBe(2);
  });

  it("memory.search finds notes by query", async () => {
    const { handleMemoryAdd, handleMemorySearch } = await import("../handlers/memory.js");
    handleMemoryAdd({ content: "The quick brown fox" });
    handleMemoryAdd({ content: "A lazy dog" });
    const result = handleMemorySearch({ query: "brown fox" });
    expect(result.ok).toBe(true);
    const payload = result.payload as { notes: unknown[]; count: number };
    expect(payload.count).toBe(1);
  });

  it("memory.list returns notes for a scope", async () => {
    const { handleMemoryAdd, handleMemoryList } = await import("../handlers/memory.js");
    handleMemoryAdd({ content: "Note 1" });
    handleMemoryAdd({ content: "Note 2" });
    const result = handleMemoryList({ scope: "global" });
    expect(result.ok).toBe(true);
    const payload = result.payload as { notes: unknown[]; count: number };
    expect(payload.count).toBe(2);
  });
});
