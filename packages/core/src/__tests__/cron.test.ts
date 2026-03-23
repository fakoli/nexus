import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), "nexus-cron-test-"));
}

async function freshDb(dir: string) {
  process.env.NEXUS_DATA_DIR = dir;
  const db = await import("../db.js");
  db.closeDb();
  db.runMigrations();
  const { createAgent } = await import("../agents.js");
  try { createAgent("agent-1"); } catch { /* exists */ }
  return db;
}

describe("cron: createCronJob / getCronJob", () => {
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

  it("creates a job and returns it", async () => {
    const { createCronJob } = await import("../cron.js");
    const job = createCronJob({ id: "job-1", schedule: "@every 1h", agentId: "agent-1", message: "hello", enabled: true });
    expect(job.id).toBe("job-1");
    expect(job.schedule).toBe("@every 1h");
    expect(job.agentId).toBe("agent-1");
    expect(job.enabled).toBe(true);
  });

  it("getCronJob returns null for unknown id", async () => {
    const { getCronJob } = await import("../cron.js");
    expect(getCronJob("does-not-exist")).toBeNull();
  });

  it("getCronJob retrieves by id", async () => {
    const { createCronJob, getCronJob } = await import("../cron.js");
    createCronJob({ id: "job-get", schedule: "*/5 * * * *", agentId: "agent-1", message: "ping", enabled: true });
    const job = getCronJob("job-get");
    expect(job).not.toBeNull();
    expect(job!.message).toBe("ping");
  });

  it("auto-generates an id when not supplied", async () => {
    const { createCronJob } = await import("../cron.js");
    const job = createCronJob({ schedule: "@every 30m", agentId: "agent-1", message: "auto", enabled: true });
    expect(job.id).toBeTruthy();
    expect(job.id.length).toBeGreaterThan(8);
  });
});

describe("cron: listCronJobs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { createAgent } = await import("../agents.js");
    try { createAgent("agent-2"); } catch { /* exists */ }
  });

  afterEach(async () => {
    const db = await import("../db.js");
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when no jobs", async () => {
    const { listCronJobs } = await import("../cron.js");
    expect(listCronJobs()).toEqual([]);
  });

  it("lists all jobs", async () => {
    const { createCronJob, listCronJobs } = await import("../cron.js");
    createCronJob({ id: "j1", schedule: "@every 1h", agentId: "agent-1", message: "a", enabled: true });
    createCronJob({ id: "j2", schedule: "@every 2h", agentId: "agent-2", message: "b", enabled: false });
    expect(listCronJobs().length).toBe(2);
  });

  it("filters by agentId", async () => {
    const { createCronJob, listCronJobs } = await import("../cron.js");
    createCronJob({ id: "ja1", schedule: "@every 1h", agentId: "agent-1", message: "a", enabled: true });
    createCronJob({ id: "ja2", schedule: "@every 1h", agentId: "agent-2", message: "b", enabled: true });
    const result = listCronJobs("agent-1");
    expect(result.length).toBe(1);
    expect(result[0].agentId).toBe("agent-1");
  });

  it("filters by enabled status", async () => {
    const { createCronJob, listCronJobs } = await import("../cron.js");
    createCronJob({ id: "je1", schedule: "@every 1h", agentId: "agent-1", message: "on", enabled: true });
    createCronJob({ id: "je2", schedule: "@every 1h", agentId: "agent-1", message: "off", enabled: false });
    const enabled = listCronJobs(undefined, true);
    expect(enabled.every((j) => j.enabled)).toBe(true);
    const disabled = listCronJobs(undefined, false);
    expect(disabled.every((j) => !j.enabled)).toBe(true);
  });
});

describe("cron: updateCronJob / deleteCronJob", () => {
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

  it("updates schedule and enabled fields", async () => {
    const { createCronJob, updateCronJob, getCronJob } = await import("../cron.js");
    createCronJob({ id: "upd-1", schedule: "@every 1h", agentId: "agent-1", message: "hi", enabled: true });
    updateCronJob("upd-1", { schedule: "@every 2h", enabled: false });
    const updated = getCronJob("upd-1");
    expect(updated!.schedule).toBe("@every 2h");
    expect(updated!.enabled).toBe(false);
  });

  it("deleteCronJob returns true on success", async () => {
    const { createCronJob, deleteCronJob } = await import("../cron.js");
    createCronJob({ id: "del-1", schedule: "@every 1h", agentId: "agent-1", message: "bye", enabled: true });
    expect(deleteCronJob("del-1")).toBe(true);
  });

  it("deleteCronJob returns false for unknown id", async () => {
    const { deleteCronJob } = await import("../cron.js");
    expect(deleteCronJob("ghost")).toBe(false);
  });
});

describe("cron: getDueJobs", () => {
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

  it("returns jobs with next_run_at in the past", async () => {
    const { createCronJob, updateCronJob, getDueJobs } = await import("../cron.js");
    createCronJob({ id: "due-1", schedule: "@every 1h", agentId: "agent-1", message: "run me", enabled: true });
    const past = Math.floor(Date.now() / 1000) - 3600;
    updateCronJob("due-1", { nextRunAt: past });
    const due = getDueJobs();
    expect(due.some((j) => j.id === "due-1")).toBe(true);
  });

  it("does not return jobs with next_run_at in the future", async () => {
    const { createCronJob, updateCronJob, getDueJobs } = await import("../cron.js");
    createCronJob({ id: "fut-1", schedule: "@every 1h", agentId: "agent-1", message: "not yet", enabled: true });
    const future = Math.floor(Date.now() / 1000) + 3600;
    updateCronJob("fut-1", { nextRunAt: future });
    const due = getDueJobs();
    expect(due.some((j) => j.id === "fut-1")).toBe(false);
  });

  it("does not return disabled jobs", async () => {
    const { createCronJob, updateCronJob, getDueJobs } = await import("../cron.js");
    createCronJob({ id: "dis-1", schedule: "@every 1h", agentId: "agent-1", message: "disabled", enabled: false });
    const past = Math.floor(Date.now() / 1000) - 3600;
    updateCronJob("dis-1", { nextRunAt: past });
    const due = getDueJobs();
    expect(due.some((j) => j.id === "dis-1")).toBe(false);
  });
});

describe("cron: recordCronRun / getCronHistory", () => {
  let dir: string;

  beforeEach(async () => {
    dir = makeTmpDir();
    await freshDb(dir);
    const { createCronJob } = await import("../cron.js");
    createCronJob({ id: "hist-job", schedule: "@every 1h", agentId: "agent-1", message: "check", enabled: true });
  });

  afterEach(async () => {
    const db = await import("../db.js");
    db.closeDb();
    delete process.env.NEXUS_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("recordCronRun returns a positive id", async () => {
    const { recordCronRun } = await import("../cron.js");
    const id = recordCronRun("hist-job", "success", "all good", 42);
    expect(id).toBeGreaterThan(0);
  });

  it("getCronHistory returns recorded runs", async () => {
    const { recordCronRun, getCronHistory } = await import("../cron.js");
    recordCronRun("hist-job", "success", "result", 100);
    recordCronRun("hist-job", "error", undefined, 0, "oops");
    const history = getCronHistory("hist-job");
    expect(history.length).toBe(2);
  });

  it("getCronHistory respects limit", async () => {
    const { recordCronRun, getCronHistory } = await import("../cron.js");
    for (let i = 0; i < 5; i++) recordCronRun("hist-job", "success");
    const history = getCronHistory("hist-job", 3);
    expect(history.length).toBe(3);
  });

  it("getCronHistory records error field", async () => {
    const { recordCronRun, getCronHistory } = await import("../cron.js");
    recordCronRun("hist-job", "error", undefined, 0, "something went wrong");
    const history = getCronHistory("hist-job");
    expect(history[0].error).toBe("something went wrong");
    expect(history[0].status).toBe("error");
  });

  it("getCronHistory returns empty array for job with no runs", async () => {
    const { createCronJob, getCronHistory } = await import("../cron.js");
    createCronJob({ id: "no-runs", schedule: "@every 1h", agentId: "agent-1", message: "never ran", enabled: true });
    expect(getCronHistory("no-runs")).toEqual([]);
  });
});
