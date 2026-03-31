/**
 * LifecycleManager — health checks, restart policies, log capture, event emission.
 */

import { createLogger, events } from "@nexus/core";
import { ContainerConfigSchema } from "./types.js";
import type { ContainerConfig, ContainerState, ContainerStats } from "./types.js";
import { ContainerRuntime, ContainerNotFoundError } from "./runtime.js";
import type { WasmContainer, ContainerRuntimeOptions, LogEntry } from "./runtime.js";

const log = createLogger("container:lifecycle");

// ── Public interface types ────────────────────────────────────────────────────

export interface HealthCheckState {
  containerId: string;
  consecutiveFailures: number;
  lastProbeAt: string | undefined;
  lastProbeSuccess: boolean | undefined;
  inStartPeriod: boolean;
}

export interface ManagedContainerEntry {
  container: WasmContainer;
  healthState: HealthCheckState | undefined;
  healthIntervalHandle: ReturnType<typeof setInterval> | undefined;
  startPeriodHandle: ReturnType<typeof setTimeout> | undefined;
  config: ContainerConfig;
}

export interface LifecycleManagerOptions {
  runtimeOptions?: ContainerRuntimeOptions;
  maxLogLines?: number;
}

export interface StartResult {
  containerId: string;
  state: ContainerState;
}

// ── Backoff helper ────────────────────────────────────────────────────────────

function backoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 60_000);
}

// ── LifecycleManager ──────────────────────────────────────────────────────────

export class LifecycleManager {
  private readonly runtime: ContainerRuntime;
  private readonly entries = new Map<string, ManagedContainerEntry>();
  private readonly maxLogLines: number;
  private readonly restartAttempts = new Map<string, number>();

  constructor(options: LifecycleManagerOptions = {}) {
    this.runtime = new ContainerRuntime(options.runtimeOptions);
    this.maxLogLines = options.maxLogLines ?? 1000;
  }

  async start(config: ContainerConfig): Promise<StartResult> {
    const validated = ContainerConfigSchema.parse(config);
    const container = await this.runtime.create(validated);
    await container.start();

    const entry: ManagedContainerEntry = {
      container,
      healthState: undefined,
      healthIntervalHandle: undefined,
      startPeriodHandle: undefined,
      config: validated,
    };
    this.entries.set(container.id, entry);
    this.restartAttempts.set(container.id, 0);

    // Schedule health checks
    if (validated.healthCheck) {
      const hc = validated.healthCheck;
      const healthState: HealthCheckState = {
        containerId: container.id,
        consecutiveFailures: 0,
        lastProbeAt: undefined,
        lastProbeSuccess: undefined,
        inStartPeriod: hc.startPeriodMs > 0,
      };
      entry.healthState = healthState;

      if (hc.startPeriodMs > 0) {
        entry.startPeriodHandle = setTimeout(() => {
          healthState.inStartPeriod = false;
          healthState.consecutiveFailures = 0;
        }, hc.startPeriodMs);
      }

      entry.healthIntervalHandle = setInterval(() => {
        this.runHealthCheck(container.id).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ containerId: container.id, err: msg }, "Health check error");
        });
      }, hc.intervalMs);
    }

    events.emit("container:started", { containerId: container.id, image: validated.image });
    log.info({ containerId: container.id, image: validated.image }, "Container started under supervision");

    return { containerId: container.id, state: container.getState() };
  }

  async stop(containerId: string): Promise<void> {
    const entry = this.requireEntry(containerId);
    this.cancelTimers(entry);

    const state = entry.container.getState();
    await entry.container.stop();

    events.emit("container:stopped", { containerId, exitCode: state.exitCode ?? null });
    this.entries.delete(containerId);
    this.restartAttempts.delete(containerId);
    log.info({ containerId }, "Container stopped and removed from supervision");
  }

  async call(containerId: string, functionName: string, input: string): Promise<string | null> {
    const entry = this.requireEntry(containerId);
    return entry.container.call(functionName, input);
  }

  getState(containerId: string): ContainerState {
    return this.requireEntry(containerId).container.getState();
  }

  async getStats(containerId: string): Promise<ContainerStats> {
    return this.requireEntry(containerId).container.stats();
  }

  getHealthState(containerId: string): HealthCheckState | undefined {
    return this.requireEntry(containerId).healthState;
  }

  async getLogs(containerId: string, limit = 100): Promise<LogEntry[]> {
    return this.requireEntry(containerId).container.logs(limit);
  }

  listContainerIds(): string[] {
    return Array.from(this.entries.keys());
  }

  async shutdown(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.entries.keys()).map((id) => this.stop(id)),
    );
    for (const r of results) {
      if (r.status === "rejected") {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        log.error({ err: msg }, "Error stopping container during shutdown");
      }
    }
  }

  getManagedEntry(containerId: string): ManagedContainerEntry | undefined {
    return this.entries.get(containerId);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private requireEntry(containerId: string): ManagedContainerEntry {
    const entry = this.entries.get(containerId);
    if (!entry) throw new ContainerNotFoundError(containerId);
    return entry;
  }

  private cancelTimers(entry: ManagedContainerEntry): void {
    if (entry.healthIntervalHandle !== undefined) {
      clearInterval(entry.healthIntervalHandle);
      entry.healthIntervalHandle = undefined;
    }
    if (entry.startPeriodHandle !== undefined) {
      clearTimeout(entry.startPeriodHandle);
      entry.startPeriodHandle = undefined;
    }
  }

  private async runHealthCheck(containerId: string): Promise<void> {
    const entry = this.entries.get(containerId);
    if (!entry || !entry.healthState || !entry.config.healthCheck) return;

    const hc = entry.config.healthCheck;
    const hs = entry.healthState;
    hs.lastProbeAt = new Date().toISOString();

    let success = false;
    try {
      const result = await entry.container.call(hc.functionName, "{}", { timeoutMs: hc.timeoutMs });
      success = result !== null;
    } catch {
      success = false;
    }

    hs.lastProbeSuccess = success;
    if (success) {
      hs.consecutiveFailures = 0;
      entry.container.setState({ error: undefined });
      return;
    }

    if (!hs.inStartPeriod) {
      hs.consecutiveFailures++;
      entry.container.appendLog("stderr", `Health check failed (${hs.consecutiveFailures}/${hc.retries})`);

      if (hs.consecutiveFailures >= hc.retries) {
        entry.container.setState({ status: "unhealthy", error: `Health check failed ${hs.consecutiveFailures} times` });
        events.emit("container:unhealthy", { containerId, consecutiveFailures: hs.consecutiveFailures });
        log.warn({ containerId, consecutiveFailures: hs.consecutiveFailures }, "Container unhealthy");
        await this.handleFailure(containerId);
      }
    }
  }

  private async handleFailure(containerId: string): Promise<void> {
    const entry = this.entries.get(containerId);
    if (!entry) return;

    const policy = entry.config.restartPolicy;
    const state = entry.container.getState();
    const errMsg = state.error ?? "unknown error";

    events.emit("container:failed", { containerId, error: errMsg });

    if (policy.mode === "never") return;
    if (policy.mode === "on-failure" && state.exitCode === 0) return;

    const attempts = this.restartAttempts.get(containerId) ?? 0;
    if (policy.mode === "on-failure" && attempts >= policy.maxRetries) {
      log.error({ containerId, attempts }, "Max restart attempts reached");
      return;
    }

    const delay = backoffMs(attempts);
    this.restartAttempts.set(containerId, attempts + 1);
    log.info({ containerId, delay, attempt: attempts + 1 }, "Scheduling restart");

    await new Promise<void>((resolve) => setTimeout(resolve, delay));

    // Re-check: the container may have been removed during the backoff sleep.
    const currentEntry = this.entries.get(containerId);
    if (!currentEntry) {
      log.warn({ containerId }, "Container removed during restart backoff — aborting restart");
      return;
    }

    try {
      await currentEntry.container.restart();
      const newCount = (state.restartCount ?? 0) + 1;
      currentEntry.container.setState({ restartCount: newCount });
      events.emit("container:restarted", { containerId, restartCount: newCount });
      log.info({ containerId, restartCount: newCount }, "Container restarted");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ containerId, err: msg }, "Restart failed");
      currentEntry.container.setState({ status: "failed", error: msg });
    }
  }
}
