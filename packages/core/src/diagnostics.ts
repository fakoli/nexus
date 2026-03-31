/**
 * Nexus diagnostics — memory monitoring and heap snapshot tooling.
 *
 * All functions return a stop/cleanup function so callers can register
 * them in gateway close() without leaking timers or signal handlers.
 */
import v8 from "node:v8";
import { createLogger } from "./logger.js";

const log = createLogger("core:diagnostics");

/** Interval for memory usage logging (5 minutes). */
const MEMORY_MONITOR_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Start logging process.memoryUsage() at debug level every 5 minutes.
 * Returns a stop function that clears the interval.
 */
export function startMemoryMonitor(): () => void {
  const interval = setInterval(() => {
    const usage = process.memoryUsage();
    log.debug(
      {
        rss: usage.rss,
        heapTotal: usage.heapTotal,
        heapUsed: usage.heapUsed,
        external: usage.external,
      },
      "Memory usage",
    );
  }, MEMORY_MONITOR_INTERVAL_MS);

  // Allow the process to exit even if the interval is still active.
  interval.unref();

  return () => {
    clearInterval(interval);
  };
}

/**
 * Register a SIGUSR2 handler that writes a V8 heap snapshot to disk and
 * logs the resulting file path. Returns a cleanup function that removes
 * the handler.
 */
export function enableHeapSnapshotOnSignal(): () => void {
  const handler = () => {
    try {
      const filePath = v8.writeHeapSnapshot();
      log.info({ filePath }, "Heap snapshot written");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, "Failed to write heap snapshot");
    }
  };

  process.on("SIGUSR2", handler);

  return () => {
    process.off("SIGUSR2", handler);
  };
}

export interface MemoryGrowthOptions {
  /** Warn if heap grows by more than this percentage within windowMs. */
  thresholdPercent: number;
  /** Time window in milliseconds for growth detection. */
  windowMs: number;
}

const DEFAULT_GROWTH_OPTIONS: MemoryGrowthOptions = {
  thresholdPercent: 50,
  windowMs: 10 * 60 * 1000,
};

/**
 * Track heap usage over time and emit a warning if growth exceeds
 * `thresholdPercent` within `windowMs`. Returns a stop function.
 */
export function detectMemoryGrowth(
  options: Partial<MemoryGrowthOptions> = {},
): () => void {
  const { thresholdPercent, windowMs } = {
    ...DEFAULT_GROWTH_OPTIONS,
    ...options,
  };

  // Sample every 1/10th of the window, minimum 1 second.
  const sampleInterval = Math.max(1000, Math.floor(windowMs / 10));

  /** Ring buffer of (timestamp, heapUsed) samples. */
  const samples: Array<{ ts: number; heapUsed: number }> = [];

  const interval = setInterval(() => {
    const now = Date.now();
    const heapUsed = process.memoryUsage().heapUsed;

    samples.push({ ts: now, heapUsed });

    // Drop samples older than the window.
    const cutoff = now - windowMs;
    while (samples.length > 0 && (samples[0]?.ts ?? 0) < cutoff) {
      samples.shift();
    }

    if (samples.length < 2) return;

    const oldest = samples[0];
    if (oldest === undefined) return;
    const growthFraction = (heapUsed - oldest.heapUsed) / oldest.heapUsed;
    const growthPercent = growthFraction * 100;

    if (growthPercent > thresholdPercent) {
      log.warn(
        {
          growthPercent: Math.round(growthPercent),
          thresholdPercent,
          windowMs,
          heapUsedBytes: heapUsed,
          baselineBytes: oldest.heapUsed,
        },
        "Heap memory growth detected",
      );
    }
  }, sampleInterval);

  interval.unref();

  return () => {
    clearInterval(interval);
    samples.length = 0;
  };
}
