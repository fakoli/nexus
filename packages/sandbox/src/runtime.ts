/**
 * Sandbox runtime abstraction — pluggable interface for executing guest code.
 *
 * The InProcessRuntime provides a mock/stub implementation that runs host
 * functions directly (no Wasm). The real Extism backend can be swapped in
 * when available without changing any call sites.
 */
import { createLogger } from "@nexus/core";
import type { AgentCapabilities } from "./capabilities.js";

const log = createLogger("sandbox:runtime");

// ── Public interfaces ───────────────────────────────────────────────

export type HostFunction = (input: string) => Promise<string>;

export interface SandboxInstance {
  id: string;
  call(functionName: string, input: string): Promise<string>;
  getMemoryUsage(): number; // bytes
  reset(): Promise<void>;
  close(): Promise<void>;
}

export interface SandboxRuntimeConfig {
  capabilities: AgentCapabilities;
  hostFunctions?: Map<string, HostFunction>;
}

export interface SandboxRuntime {
  create(config: SandboxRuntimeConfig): Promise<SandboxInstance>;
}

// ── InProcessSandbox ────────────────────────────────────────────────

/**
 * In-process sandbox implementation (no Wasm).
 *
 * Dispatches calls to registered host functions with timeout enforcement.
 * Used for development and testing when Extism is unavailable.
 */
export class InProcessSandbox implements SandboxInstance {
  readonly id: string;
  private readonly capabilities: AgentCapabilities;
  private readonly hostFunctions: Map<string, HostFunction>;
  private closed = false;
  private callCount = 0;

  constructor(
    id: string,
    config: SandboxRuntimeConfig,
  ) {
    this.id = id;
    this.capabilities = config.capabilities;
    this.hostFunctions = config.hostFunctions ?? new Map();
  }

  async call(functionName: string, input: string): Promise<string> {
    if (this.closed) throw new Error(`Sandbox ${this.id} is closed`);
    this.callCount++;

    const fn = this.hostFunctions.get(functionName);
    if (!fn) {
      return JSON.stringify({ error: `Unknown function: ${functionName}` });
    }

    const timeoutMs = this.capabilities.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await Promise.race<string>([
        fn(input),
        new Promise<string>((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new Error(`Sandbox call timed out after ${timeoutMs}ms`)),
          );
        }),
      ]);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  getMemoryUsage(): number {
    return process.memoryUsage().heapUsed;
  }

  async reset(): Promise<void> {
    if (this.closed) throw new Error(`Sandbox ${this.id} is closed`);
    this.callCount = 0;
    log.debug({ sandboxId: this.id }, "Sandbox reset");
  }

  async close(): Promise<void> {
    this.closed = true;
    log.debug({ sandboxId: this.id }, "Sandbox closed");
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get totalCallCount(): number {
    return this.callCount;
  }
}

// ── InProcessRuntime ────────────────────────────────────────────────

export class InProcessRuntime implements SandboxRuntime {
  async create(config: SandboxRuntimeConfig): Promise<SandboxInstance> {
    const id = `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const instance = new InProcessSandbox(id, config);
    log.info({ sandboxId: id }, "InProcess sandbox created");
    return instance;
  }
}

// ── SandboxPool ─────────────────────────────────────────────────────

interface PoolEntry {
  instance: SandboxInstance;
  agentId: string;
  inUse: boolean;
  createdAt: number;
}

export interface SandboxPoolOptions {
  runtime: SandboxRuntime;
  maxInstances?: number;
}

/**
 * Pool that manages sandbox lifecycle per agent.
 * Reuses existing instances where possible to avoid repeated startup cost.
 */
export class SandboxPool {
  private readonly runtime: SandboxRuntime;
  private readonly maxInstances: number;
  private readonly pool = new Map<string, PoolEntry>();

  constructor(options: SandboxPoolOptions) {
    this.runtime = options.runtime;
    this.maxInstances = options.maxInstances ?? 10;
  }

  async acquire(agentId: string, config: SandboxRuntimeConfig): Promise<SandboxInstance> {
    // Find a free existing instance for this agent
    for (const entry of this.pool.values()) {
      if (entry.agentId === agentId && !entry.inUse) {
        entry.inUse = true;
        log.debug({ agentId, sandboxId: entry.instance.id }, "Sandbox acquired from pool");
        return entry.instance;
      }
    }

    if (this.pool.size >= this.maxInstances) {
      throw new Error(
        `Sandbox pool at capacity (${this.maxInstances}). Cannot create new instance for agent ${agentId}.`,
      );
    }

    const instance = await this.runtime.create(config);
    this.pool.set(instance.id, {
      instance,
      agentId,
      inUse: true,
      createdAt: Date.now(),
    });
    log.info({ agentId, sandboxId: instance.id, poolSize: this.pool.size }, "New sandbox added to pool");
    return instance;
  }

  async release(instance: SandboxInstance): Promise<void> {
    const entry = this.pool.get(instance.id);
    if (!entry) return;

    await instance.reset();
    entry.inUse = false;
    log.debug({ sandboxId: instance.id }, "Sandbox released to pool");
  }

  async destroyAll(): Promise<void> {
    const closePromises: Array<Promise<void>> = [];
    for (const entry of this.pool.values()) {
      closePromises.push(entry.instance.close());
    }
    await Promise.allSettled(closePromises);
    this.pool.clear();
    log.info("All sandboxes destroyed");
  }

  get activeCount(): number {
    let count = 0;
    for (const entry of this.pool.values()) {
      if (entry.inUse) count++;
    }
    return count;
  }

  get totalCount(): number {
    return this.pool.size;
  }
}
