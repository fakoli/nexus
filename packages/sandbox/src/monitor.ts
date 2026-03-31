/**
 * Sandbox resource monitor — tracks memory usage across sandbox instances
 * and fires callbacks when limits are exceeded.
 */
import { createLogger } from "@nexus/core";
import type { SandboxInstance } from "./runtime.js";

const log = createLogger("sandbox:monitor");

export interface SandboxMetrics {
  instanceId: string;
  agentId: string;
  memoryBytes: number;
  callCount: number;
  createdAt: number;
  lastCallAt: number;
}

interface TrackedEntry {
  instance: SandboxInstance;
  agentId: string;
  callCount: number;
  createdAt: number;
  lastCallAt: number;
}

export interface SandboxMonitorOptions {
  maxMemoryBytes?: number;
  checkIntervalMs?: number;
}

const DEFAULT_MAX_MEMORY_BYTES = 256 * 1024 * 1024; // 256 MB
const DEFAULT_CHECK_INTERVAL_MS = 5000; // 5 s

export class SandboxMonitor {
  private readonly maxMemoryBytes: number;
  private readonly checkIntervalMs: number;
  private readonly tracked = new Map<string, TrackedEntry>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SandboxMonitorOptions = {}) {
    this.maxMemoryBytes = options.maxMemoryBytes ?? DEFAULT_MAX_MEMORY_BYTES;
    this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  }

  track(instance: SandboxInstance, agentId: string): void {
    this.tracked.set(instance.id, {
      instance,
      agentId,
      callCount: 0,
      createdAt: Date.now(),
      lastCallAt: Date.now(),
    });
    log.debug({ instanceId: instance.id, agentId }, "Sandbox tracked");
  }

  untrack(instanceId: string): void {
    this.tracked.delete(instanceId);
    log.debug({ instanceId }, "Sandbox untracked");
  }

  /** Increment the call counter for a tracked sandbox (called after each sandbox.call). */
  recordCall(instanceId: string): void {
    const entry = this.tracked.get(instanceId);
    if (!entry) return;
    entry.callCount++;
    entry.lastCallAt = Date.now();
  }

  getMetrics(): SandboxMetrics[] {
    const result: SandboxMetrics[] = [];
    for (const [instanceId, entry] of this.tracked) {
      result.push({
        instanceId,
        agentId: entry.agentId,
        memoryBytes: entry.instance.getMemoryUsage(),
        callCount: entry.callCount,
        createdAt: entry.createdAt,
        lastCallAt: entry.lastCallAt,
      });
    }
    return result;
  }

  getMetricsFor(instanceId: string): SandboxMetrics | undefined {
    const entry = this.tracked.get(instanceId);
    if (!entry) return undefined;
    return {
      instanceId,
      agentId: entry.agentId,
      memoryBytes: entry.instance.getMemoryUsage(),
      callCount: entry.callCount,
      createdAt: entry.createdAt,
      lastCallAt: entry.lastCallAt,
    };
  }

  /** Start periodic checks. Invokes onLimitExceeded for over-limit instances. */
  start(onLimitExceeded: (metrics: SandboxMetrics) => void): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      for (const [instanceId, entry] of this.tracked) {
        const memoryBytes = entry.instance.getMemoryUsage();
        if (memoryBytes > this.maxMemoryBytes) {
          const metrics: SandboxMetrics = {
            instanceId,
            agentId: entry.agentId,
            memoryBytes,
            callCount: entry.callCount,
            createdAt: entry.createdAt,
            lastCallAt: entry.lastCallAt,
          };
          log.warn({ instanceId, agentId: entry.agentId, memoryBytes, maxMemoryBytes: this.maxMemoryBytes }, "Sandbox memory limit exceeded");
          onLimitExceeded(metrics);
        }
      }
    }, this.checkIntervalMs);
    log.info({ checkIntervalMs: this.checkIntervalMs, maxMemoryBytes: this.maxMemoryBytes }, "Sandbox monitor started");
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      log.info("Sandbox monitor stopped");
    }
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }
}
