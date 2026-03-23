/**
 * Cron runner — polls every 30 seconds for due jobs and executes them.
 *
 * Schedule format: either a standard 5-field cron expression or a simple
 * interval shorthand such as "@every 5m" / "@every 1h".
 * Next-run time is computed by advancing the last-run time by the interval
 * derived from the schedule.  Full cron-expression parsing is intentionally
 * minimal: only `* /N` (every-N) fields are supported; for richer schedules
 * install `croner` and replace `computeNextRunAt`.
 */
import { getDueJobs, updateCronJob, recordCronRun } from "./cron.js";
import { createLogger } from "./logger.js";

const log = createLogger("core:cron-runner");

// ── Schedule → interval helper ────────────────────────────────────────

/**
 * Returns the next Unix timestamp (seconds) to run a job after `fromTs`.
 * Supports:
 *   @every <N><unit>  — e.g. "@every 5m", "@every 1h", "@every 30s"
 *   star/N in minute field — e.g. "star/5 * * * *" (every 5 minutes)
 *   Falls back to 60-second interval on parse failure.
 */
export function computeNextRunAt(schedule: string, fromTs: number): number {
  const everyMatch = /^@every\s+(\d+)([smhd])$/i.exec(schedule.trim());
  if (everyMatch) {
    const n = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2].toLowerCase();
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return fromTs + n * (multipliers[unit] ?? 60);
  }

  // Parse 5-field cron; only handle */N in minute position for simplicity.
  const fields = schedule.trim().split(/\s+/);
  if (fields.length === 5) {
    const minuteField = fields[0];
    const everyN = /^\*\/(\d+)$/.exec(minuteField);
    if (everyN) {
      return fromTs + parseInt(everyN[1], 10) * 60;
    }
    // Fixed minute/hour — default 1-day interval
    return fromTs + 86400;
  }

  // Unknown format — default 1-minute interval
  log.warn({ schedule }, "Unrecognised schedule format; defaulting to 60s interval");
  return fromTs + 60;
}

// ── Runner ────────────────────────────────────────────────────────────

export function startCronRunner(): { stop: () => void } {
  let running = true;

  async function tick(): Promise<void> {
    if (!running) return;

    let jobs;
    try {
      jobs = getDueJobs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, "Failed to fetch due cron jobs");
      return;
    }

    for (const job of jobs) {
      if (!running) break;
      await runJob(job.id, job.agentId, job.message, job.schedule);
    }
  }

  const intervalId = setInterval(() => {
    tick().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, "Cron runner tick failed");
    });
  }, 30_000);

  log.info("Cron runner started (30s interval)");

  return {
    stop() {
      running = false;
      clearInterval(intervalId);
      log.info("Cron runner stopped");
    },
  };
}

// ── Job execution ─────────────────────────────────────────────────────

async function runJob(
  jobId: string,
  agentId: string,
  message: string,
  schedule: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  log.info({ jobId, agentId }, "Running cron job");

  // Update last_run_at immediately so concurrent ticks don't re-trigger.
  const nextRun = computeNextRunAt(schedule, now);
  updateCronJob(jobId, { lastRunAt: now, nextRunAt: nextRun });

  let status = "success";
  let resultSummary: string | undefined;
  let tokensUsed = 0;
  let errorMsg: string | undefined;

  try {
    // Lazy-import to avoid circular dep at module load time.
    const { runAgent } = await import("@nexus/agent");
    const sessionId = `cron-${jobId}-${now}`;
    const result = await runAgent({ sessionId, agentId, userMessage: message });
    resultSummary = result.content.slice(0, 500);
    tokensUsed = result.usage.inputTokens + result.usage.outputTokens;
    log.info({ jobId, tokens: tokensUsed }, "Cron job completed");
  } catch (err) {
    status = "error";
    errorMsg = err instanceof Error ? err.message : String(err);
    log.error({ jobId, err: errorMsg }, "Cron job failed");
  }

  try {
    recordCronRun(jobId, status, resultSummary, tokensUsed, errorMsg);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ jobId, err: msg }, "Failed to record cron run history");
  }
}
