/**
 * Tests for gateway/handlers/cron.ts
 *
 * Each handler is tested against a fresh SQLite DB in a temp directory so
 * tests are fully isolated and don't share state.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "nexus-cron-handlers-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const dbMod = await import("../../../core/src/db.js");
  dbMod.closeDb();
  dbMod.runMigrations();
  const { createAgent } = await import("@nexus/core");
  try { createAgent("agent-a"); } catch { /* already exists */ }
  return dbMod;
}

// ── cron.list ─────────────────────────────────────────────────────────────

describe("handleCronList", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const dbMod = await import("../../../core/src/db.js");
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns ok:true with empty jobs array initially", async () => {
    const { handleCronList } = await import("../handlers/cron.js");
    const result = handleCronList({});
    expect(result.ok).toBe(true);
    const payload = result.payload as { jobs: unknown[] };
    expect(Array.isArray(payload.jobs)).toBe(true);
    expect(payload.jobs.length).toBe(0);
  });

  it("lists created jobs", async () => {
    const { createCronJob } = await import("@nexus/core");
    createCronJob({ id: "list-j1", schedule: "@every 1h", agentId: "agent-a", message: "hello", enabled: true });
    const { handleCronList } = await import("../handlers/cron.js");
    const result = handleCronList({});
    expect(result.ok).toBe(true);
    const payload = result.payload as { jobs: Array<{ id: string }> };
    expect(payload.jobs.some((j) => j.id === "list-j1")).toBe(true);
  });

  it("filters by agentId", async () => {
    const { createAgent, createCronJob } = await import("@nexus/core");
    try { createAgent("agent-b"); } catch { /* exists */ }
    createCronJob({ id: "filter-ja", schedule: "@every 1h", agentId: "agent-a", message: "a", enabled: true });
    createCronJob({ id: "filter-jb", schedule: "@every 1h", agentId: "agent-b", message: "b", enabled: true });
    const { handleCronList } = await import("../handlers/cron.js");
    const result = handleCronList({ agentId: "agent-a" });
    expect(result.ok).toBe(true);
    const payload = result.payload as { jobs: Array<{ agentId: string }> };
    expect(payload.jobs.every((j) => j.agentId === "agent-a")).toBe(true);
  });
});

// ── cron.create ───────────────────────────────────────────────────────────

describe("handleCronCreate", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
  });

  afterEach(async () => {
    const dbMod = await import("../../../core/src/db.js");
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a job and returns it with nextRunAt set", async () => {
    const { handleCronCreate } = await import("../handlers/cron.js");
    const result = handleCronCreate({
      schedule: "@every 1h",
      agentId: "agent-a",
      message: "run agent",
    });
    expect(result.ok).toBe(true);
    const payload = result.payload as { job: { id: string; nextRunAt?: number } };
    expect(typeof payload.job.id).toBe("string");
    expect(payload.job.nextRunAt).toBeGreaterThan(0);
  });

  it("uses a caller-supplied id", async () => {
    const { handleCronCreate } = await import("../handlers/cron.js");
    const result = handleCronCreate({
      id: "explicit-id",
      schedule: "@every 30m",
      agentId: "agent-a",
      message: "ping",
    });
    expect(result.ok).toBe(true);
    const payload = result.payload as { job: { id: string } };
    expect(payload.job.id).toBe("explicit-id");
  });

  it("returns INVALID_PARAMS when schedule is missing", async () => {
    const { handleCronCreate } = await import("../handlers/cron.js");
    const result = handleCronCreate({ agentId: "agent-a", message: "no schedule" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns INVALID_PARAMS when agentId is missing", async () => {
    const { handleCronCreate } = await import("../handlers/cron.js");
    const result = handleCronCreate({ schedule: "@every 1h", message: "no agent" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns INVALID_PARAMS when message is missing", async () => {
    const { handleCronCreate } = await import("../handlers/cron.js");
    const result = handleCronCreate({ schedule: "@every 1h", agentId: "agent-a" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });
});

// ── cron.update ───────────────────────────────────────────────────────────

describe("handleCronUpdate", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { createCronJob } = await import("@nexus/core");
    createCronJob({ id: "upd-job", schedule: "@every 1h", agentId: "agent-a", message: "old", enabled: true });
  });

  afterEach(async () => {
    const dbMod = await import("../../../core/src/db.js");
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("updates schedule and returns updated job", async () => {
    const { handleCronUpdate } = await import("../handlers/cron.js");
    const result = handleCronUpdate({ id: "upd-job", schedule: "@every 2h" });
    expect(result.ok).toBe(true);
    const payload = result.payload as { job: { schedule: string } };
    expect(payload.job.schedule).toBe("@every 2h");
  });

  it("disables a job", async () => {
    const { handleCronUpdate } = await import("../handlers/cron.js");
    const result = handleCronUpdate({ id: "upd-job", enabled: false });
    expect(result.ok).toBe(true);
    const payload = result.payload as { job: { enabled: boolean } };
    expect(payload.job.enabled).toBe(false);
  });

  it("returns NOT_FOUND for unknown id", async () => {
    const { handleCronUpdate } = await import("../handlers/cron.js");
    const result = handleCronUpdate({ id: "ghost-id", schedule: "@every 5m" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("returns INVALID_PARAMS when id is missing", async () => {
    const { handleCronUpdate } = await import("../handlers/cron.js");
    const result = handleCronUpdate({ schedule: "@every 5m" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });
});

// ── cron.delete ───────────────────────────────────────────────────────────

describe("handleCronDelete", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { createCronJob } = await import("@nexus/core");
    createCronJob({ id: "del-job", schedule: "@every 1h", agentId: "agent-a", message: "bye", enabled: true });
  });

  afterEach(async () => {
    const dbMod = await import("../../../core/src/db.js");
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("deletes an existing job and returns deleted:true", async () => {
    const { handleCronDelete } = await import("../handlers/cron.js");
    const result = handleCronDelete({ id: "del-job" });
    expect(result.ok).toBe(true);
    const payload = result.payload as { deleted: boolean };
    expect(payload.deleted).toBe(true);
  });

  it("returns NOT_FOUND for unknown id", async () => {
    const { handleCronDelete } = await import("../handlers/cron.js");
    const result = handleCronDelete({ id: "no-such-job" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("returns INVALID_PARAMS when id is missing", async () => {
    const { handleCronDelete } = await import("../handlers/cron.js");
    const result = handleCronDelete({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });
});

// ── cron.history ──────────────────────────────────────────────────────────

describe("handleCronHistory", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { createCronJob, recordCronRun } = await import("@nexus/core");
    createCronJob({ id: "hist-job", schedule: "@every 1h", agentId: "agent-a", message: "check", enabled: true });
    recordCronRun("hist-job", "success", "all good", 42);
    recordCronRun("hist-job", "error", undefined, 0, "oops");
  });

  afterEach(async () => {
    const dbMod = await import("../../../core/src/db.js");
    dbMod.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns run history for a known job", async () => {
    const { handleCronHistory } = await import("../handlers/cron.js");
    const result = handleCronHistory({ id: "hist-job" });
    expect(result.ok).toBe(true);
    const payload = result.payload as { history: unknown[] };
    expect(payload.history.length).toBe(2);
  });

  it("respects limit param", async () => {
    const { handleCronHistory } = await import("../handlers/cron.js");
    const result = handleCronHistory({ id: "hist-job", limit: 1 });
    expect(result.ok).toBe(true);
    const payload = result.payload as { history: unknown[] };
    expect(payload.history.length).toBe(1);
  });

  it("returns NOT_FOUND for unknown job id", async () => {
    const { handleCronHistory } = await import("../handlers/cron.js");
    const result = handleCronHistory({ id: "ghost-job" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("returns INVALID_PARAMS when id is missing", async () => {
    const { handleCronHistory } = await import("../handlers/cron.js");
    const result = handleCronHistory({});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns INVALID_PARAMS when limit exceeds 200", async () => {
    const { handleCronHistory } = await import("../handlers/cron.js");
    const result = handleCronHistory({ id: "hist-job", limit: 201 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PARAMS");
  });
});
