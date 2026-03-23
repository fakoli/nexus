/**
 * Cron RPC handlers.
 *
 * - cron.list    — list cron jobs (optional agentId filter)
 * - cron.create  — create a new cron job
 * - cron.update  — update fields on an existing job
 * - cron.delete  — delete a job
 * - cron.run     — manually trigger a job now
 * - cron.history — get run history for a job
 */
import { z } from "zod";
import {
  createCronJob,
  listCronJobs,
  getCronJob,
  updateCronJob,
  deleteCronJob,
  getCronHistory,
  recordCronRun,
  computeNextRunAt,
  createLogger,
} from "@nexus/core";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:cron");

// ── Param schemas ─────────────────────────────────────────────────────

const CronListParams = z.object({
  agentId: z.string().optional(),
  enabled: z.boolean().optional(),
});

const CronCreateParams = z.object({
  id: z.string().optional(),
  schedule: z.string().min(1),
  agentId: z.string().min(1),
  message: z.string().min(1),
  enabled: z.boolean().default(true),
});

const CronUpdateParams = z.object({
  id: z.string(),
  schedule: z.string().optional(),
  message: z.string().optional(),
  enabled: z.boolean().optional(),
});

const CronDeleteParams = z.object({
  id: z.string(),
});

const CronRunParams = z.object({
  id: z.string(),
});

const CronHistoryParams = z.object({
  id: z.string(),
  limit: z.number().int().positive().max(200).default(50),
});

// ── Handlers ──────────────────────────────────────────────────────────

export function handleCronList(params: Record<string, unknown>): ResponseFrame {
  const parsed = CronListParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  const jobs = listCronJobs(parsed.data.agentId, parsed.data.enabled);
  return { id: "", ok: true, payload: { jobs } };
}

export function handleCronCreate(params: Record<string, unknown>): ResponseFrame {
  const parsed = CronCreateParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  const { id, schedule, agentId, message, enabled } = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  const job = createCronJob({ id, schedule, agentId, message, enabled });
  // Set initial nextRunAt
  updateCronJob(job.id, { nextRunAt: computeNextRunAt(schedule, now) });
  const updated = getCronJob(job.id);
  log.info({ jobId: job.id, schedule }, "Cron job created");
  return { id: "", ok: true, payload: { job: updated } };
}

export function handleCronUpdate(params: Record<string, unknown>): ResponseFrame {
  const parsed = CronUpdateParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  const { id, ...updates } = parsed.data;
  if (!getCronJob(id)) {
    return { id: "", ok: false, error: { code: "NOT_FOUND", message: `Cron job ${id} not found` } };
  }
  updateCronJob(id, updates);
  log.info({ jobId: id }, "Cron job updated");
  return { id: "", ok: true, payload: { job: getCronJob(id) } };
}

export function handleCronDelete(params: Record<string, unknown>): ResponseFrame {
  const parsed = CronDeleteParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  const deleted = deleteCronJob(parsed.data.id);
  if (!deleted) {
    return { id: "", ok: false, error: { code: "NOT_FOUND", message: `Cron job ${parsed.data.id} not found` } };
  }
  log.info({ jobId: parsed.data.id }, "Cron job deleted");
  return { id: "", ok: true, payload: { deleted: true } };
}

export async function handleCronRun(params: Record<string, unknown>): Promise<ResponseFrame> {
  const parsed = CronRunParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  const job = getCronJob(parsed.data.id);
  if (!job) {
    return { id: "", ok: false, error: { code: "NOT_FOUND", message: `Cron job ${parsed.data.id} not found` } };
  }

  try {
    const { runAgent } = await import("@nexus/agent");
    const now = Math.floor(Date.now() / 1000);
    const sessionId = `cron-manual-${job.id}-${now}`;
    const result = await runAgent({ sessionId, agentId: job.agentId, userMessage: job.message });
    const tokens = result.usage.inputTokens + result.usage.outputTokens;
    const histId = recordCronRun(job.id, "success", result.content.slice(0, 500), tokens);
    log.info({ jobId: job.id, tokens }, "Manual cron job run complete");
    return { id: "", ok: true, payload: { historyId: histId, content: result.content, tokens } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordCronRun(job.id, "error", undefined, 0, msg);
    log.error({ jobId: job.id, err: msg }, "Manual cron job run failed");
    return { id: "", ok: false, error: { code: "AGENT_ERROR", message: msg } };
  }
}

export function handleCronHistory(params: Record<string, unknown>): ResponseFrame {
  const parsed = CronHistoryParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  if (!getCronJob(parsed.data.id)) {
    return { id: "", ok: false, error: { code: "NOT_FOUND", message: `Cron job ${parsed.data.id} not found` } };
  }
  const history = getCronHistory(parsed.data.id, parsed.data.limit);
  return { id: "", ok: true, payload: { history } };
}
