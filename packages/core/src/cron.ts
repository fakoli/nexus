/**
 * Cron job CRUD and run-history helpers.
 *
 * Uses the `cron_jobs` table (migration v1) and `cron_run_history` (migration v3).
 */
import { v4 as uuid } from "uuid";
import { getDb } from "./db.js";
import type { CronJob } from "./types.js";

export interface CronRunHistory {
  id: number;
  jobId: string;
  status: string;
  startedAt: number;
  finishedAt?: number;
  resultSummary?: string;
  tokensUsed: number;
  error?: string;
}

// ── Row shape returned by SQLite ─────────────────────────────────────

interface CronJobRow {
  id: string;
  schedule: string;
  agent_id: string;
  message: string;
  enabled: number;
  last_run_at: number | null;
  next_run_at: number | null;
}

interface CronHistoryRow {
  id: number;
  job_id: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  result_summary: string | null;
  tokens_used: number;
  error: string | null;
}

function rowToJob(row: CronJobRow): CronJob {
  return {
    id: row.id,
    schedule: row.schedule,
    agentId: row.agent_id,
    message: row.message,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
  };
}

function rowToHistory(row: CronHistoryRow): CronRunHistory {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    resultSummary: row.result_summary ?? undefined,
    tokensUsed: row.tokens_used,
    error: row.error ?? undefined,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────

export function createCronJob(
  job: Omit<CronJob, "id" | "lastRunAt" | "nextRunAt"> & { id?: string },
): CronJob {
  const db = getDb();
  const id = job.id ?? uuid();
  db.prepare(
    `INSERT INTO cron_jobs (id, schedule, agent_id, message, enabled)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, job.schedule, job.agentId, job.message, job.enabled ? 1 : 0);
  return getCronJob(id) as CronJob;
}

export function listCronJobs(agentId?: string, enabled?: boolean): CronJob[] {
  const db = getDb();
  let sql = "SELECT * FROM cron_jobs WHERE 1=1";
  const params: unknown[] = [];
  if (agentId !== undefined) {
    sql += " AND agent_id = ?";
    params.push(agentId);
  }
  if (enabled !== undefined) {
    sql += " AND enabled = ?";
    params.push(enabled ? 1 : 0);
  }
  sql += " ORDER BY rowid ASC";
  const rows = db.prepare(sql).all(...params) as CronJobRow[];
  return rows.map(rowToJob);
}

export function getCronJob(id: string): CronJob | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM cron_jobs WHERE id = ?")
    .get(id) as CronJobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function updateCronJob(id: string, updates: Partial<CronJob>): void {
  const db = getDb();
  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.schedule !== undefined) { fields.push("schedule = ?"); params.push(updates.schedule); }
  if (updates.message !== undefined) { fields.push("message = ?"); params.push(updates.message); }
  if (updates.enabled !== undefined) { fields.push("enabled = ?"); params.push(updates.enabled ? 1 : 0); }
  if (updates.lastRunAt !== undefined) { fields.push("last_run_at = ?"); params.push(updates.lastRunAt); }
  if (updates.nextRunAt !== undefined) { fields.push("next_run_at = ?"); params.push(updates.nextRunAt); }

  if (fields.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE cron_jobs SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteCronJob(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getDueJobs(): CronJob[] {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const rows = db
    .prepare(
      "SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?",
    )
    .all(now) as CronJobRow[];
  return rows.map(rowToJob);
}

// ── Run history ──────────────────────────────────────────────────────

export function recordCronRun(
  jobId: string,
  status: string,
  result?: string,
  tokens?: number,
  error?: string,
): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const res = db
    .prepare(
      `INSERT INTO cron_run_history (job_id, status, started_at, finished_at, result_summary, tokens_used, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      jobId,
      status,
      now,
      now,
      result ?? null,
      tokens ?? 0,
      error ?? null,
    );
  return res.lastInsertRowid as number;
}

export function getCronHistory(jobId: string, limit = 50): CronRunHistory[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM cron_run_history WHERE job_id = ? ORDER BY started_at DESC LIMIT ?",
    )
    .all(jobId, limit) as CronHistoryRow[];
  return rows.map(rowToHistory);
}
