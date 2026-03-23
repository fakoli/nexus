import { gateway, setStore } from "./app";
import type { CronJob, CronRunHistory } from "../gateway/types";

// ── cron.list ─────────────────────────────────────────────────────────────────

/**
 * Fetches all cron jobs from the server and replaces the local list.
 */
export async function loadCronJobs(): Promise<void> {
  try {
    const payload = await gateway.request("cron.list", {});
    const jobs = (payload.jobs as CronJob[] | undefined) ?? [];
    setStore("cron", "jobs", jobs);
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── cron.create ───────────────────────────────────────────────────────────────

/**
 * Creates a new cron job and refreshes the jobs list on success.
 */
export async function createCronJob(
  job: Omit<CronJob, "id" | "lastRun" | "nextRun"> & { id?: string },
): Promise<void> {
  try {
    await gateway.request("cron.create", {
      id: job.id,
      schedule: job.schedule,
      agentId: job.agentId,
      message: job.prompt,
      enabled: job.enabled,
    });
    await loadCronJobs();
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── cron.update ───────────────────────────────────────────────────────────────

/**
 * Updates fields on an existing cron job and refreshes the list on success.
 */
export async function updateCronJob(
  id: string,
  updates: Partial<Pick<CronJob, "schedule" | "prompt" | "enabled">>,
): Promise<void> {
  try {
    await gateway.request("cron.update", {
      id,
      ...(updates.schedule !== undefined && { schedule: updates.schedule }),
      ...(updates.prompt !== undefined && { message: updates.prompt }),
      ...(updates.enabled !== undefined && { enabled: updates.enabled }),
    });
    await loadCronJobs();
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── cron.delete ───────────────────────────────────────────────────────────────

/**
 * Deletes a cron job by ID and refreshes the list on success.
 */
export async function deleteCronJob(id: string): Promise<void> {
  try {
    await gateway.request("cron.delete", { id });
    await loadCronJobs();
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── cron.run ──────────────────────────────────────────────────────────────────

/**
 * Manually triggers a cron job to run immediately.
 */
export async function runCronJob(id: string): Promise<void> {
  try {
    await gateway.request("cron.run", { id });
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}

// ── cron.history ──────────────────────────────────────────────────────────────

/**
 * Loads run history for a specific cron job into the store.
 */
export async function loadCronHistory(jobId: string): Promise<void> {
  try {
    const payload = await gateway.request("cron.history", { id: jobId });
    const history = (payload.history as CronRunHistory[] | undefined) ?? [];
    setStore("cron", "history", history);
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
  }
}
