/**
 * WasmContainer and ContainerRuntime — real implementation using Extism.
 */

import { v4 as uuid } from "uuid";
import { createLogger } from "@nexus/core";
import { ContainerConfigSchema } from "./types.js";
import type { ContainerConfig, ContainerState, ContainerStats } from "./types.js";
import type { ParsedImageRef } from "./oci-types.js";
import { MEDIA_TYPES } from "./oci-types.js";
import { OciClient, parseImageRef } from "./oci-client.js";
import { DiskBlobCache } from "./cache.js";
import type { BlobCache } from "./oci-client.js";
import os from "node:os";
import path from "node:path";

const log = createLogger("container:runtime");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContainerInspect {
  id: string;
  config: ContainerConfig;
  exports: string[];
  state: ContainerState;
}

export interface CallOptions {
  timeoutMs?: number;
  hostContext?: unknown;
}

export interface LogEntry {
  timestamp: string;
  stream: "stdout" | "stderr";
  message: string;
}

export interface ContainerRuntimeOptions {
  cachePath?: string;
  defaultPlatform?: { architecture: string; os: string };
}

// ── Error types ───────────────────────────────────────────────────────────────

export class ContainerNotFoundError extends Error {
  constructor(id: string) { super(`Container not found: ${id}`); this.name = "ContainerNotFoundError"; }
}

export class ContainerNotRunningError extends Error {
  constructor(id: string) { super(`Container not running: ${id}`); this.name = "ContainerNotRunningError"; }
}

export class ContainerStartError extends Error {
  constructor(msg: string) { super(msg); this.name = "ContainerStartError"; }
}

export class ContainerCallTimeoutError extends Error {
  constructor(fn: string) { super(`Call timed out: ${fn}`); this.name = "ContainerCallTimeoutError"; }
}

export class ContainerTrapError extends Error {
  constructor(msg: string) { super(msg); this.name = "ContainerTrapError"; }
}

// ── Volume path conversion ────────────────────────────────────────────────────

function volumesToAllowedPaths(volumes: ContainerConfig["volumes"]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const vol of volumes) {
    result[vol.guestPath] = vol.hostPath;
  }
  return result;
}

// ── WasmContainer ─────────────────────────────────────────────────────────────

type ExtismPlugin = {
  call(name: string, input?: string | Uint8Array, hostContext?: unknown): Promise<{ text(): string } | null>;
  getExports(): Promise<WebAssembly.ModuleExportDescriptor[]>;
  close(): Promise<void>;
};

export class WasmContainer {
  readonly id: string;
  readonly config: ContainerConfig;

  private state: ContainerState;
  private plugin: ExtismPlugin | null = null;
  private logBuffer: LogEntry[] = [];
  private callCount = 0;
  private startedAtMs = 0;
  private readonly wasmBytes: Uint8Array;
  private readonly maxLogLines: number;

  constructor(id: string, config: ContainerConfig, wasmBytes: Uint8Array, maxLogLines = 10000) {
    this.id = id;
    this.config = config;
    this.wasmBytes = wasmBytes;
    this.maxLogLines = maxLogLines;
    this.state = {
      status: "created",
      restartCount: 0,
      exitCode: null,
    };
  }

  async start(): Promise<void> {
    let createPlugin: (manifest: unknown, opts: unknown) => Promise<ExtismPlugin>;
    try {
      const extism = await import("@extism/extism");
      createPlugin = extism.createPlugin as typeof createPlugin;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ContainerStartError(`Extism not available: ${msg}`);
    }

    try {
      this.plugin = await createPlugin(
        { wasm: [{ data: this.wasmBytes }] },
        {
          useWasi: true,
          config: this.config.pluginConfig,
          allowedHosts: this.config.allowedHosts,
          allowedPaths: volumesToAllowedPaths(this.config.volumes),
          memory: { maxPages: this.config.memoryLimitPages },
          timeoutMs: this.config.timeoutMs,
        },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.state = { ...this.state, status: "failed", error: msg, stoppedAt: new Date().toISOString() };
      throw new ContainerStartError(`Failed to create Extism plugin: ${msg}`);
    }

    this.callCount = 0;
    this.startedAtMs = Date.now();
    this.state = {
      ...this.state,
      status: "running",
      startedAt: new Date().toISOString(),
      stoppedAt: undefined,
      exitCode: null,
      error: undefined,
    };
    log.info({ id: this.id, image: this.config.image }, "Container started");
  }

  async stop(): Promise<void> {
    if (this.state.status === "stopped") return;
    if (this.plugin) {
      try {
        await this.plugin.close();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ id: this.id, err: msg }, "Error closing plugin");
      }
      this.plugin = null;
    }
    this.state = {
      ...this.state,
      status: "stopped",
      stoppedAt: new Date().toISOString(),
      exitCode: 0,
    };
    log.info({ id: this.id }, "Container stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    this.state = { ...this.state, status: "created", stoppedAt: undefined };
    await this.start();
  }

  async call(functionName: string, input: string, options?: CallOptions): Promise<string | null> {
    if (this.state.status !== "running") {
      throw new ContainerNotRunningError(this.id);
    }
    if (!this.plugin) {
      throw new ContainerNotRunningError(this.id);
    }

    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs;

    let result: { text(): string } | null;
    try {
      const callPromise = this.plugin.call(functionName, input, options?.hostContext);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new ContainerCallTimeoutError(functionName)), timeoutMs),
      );
      result = await Promise.race([callPromise, timeoutPromise]);
    } catch (err: unknown) {
      if (err instanceof ContainerCallTimeoutError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.state = { ...this.state, status: "failed", error: msg, stoppedAt: new Date().toISOString() };
      this.plugin = null;
      throw new ContainerTrapError(msg);
    }

    this.callCount++;
    this.appendLog("stdout", `${functionName}() called`);
    return result ? result.text() : null;
  }

  async inspect(): Promise<ContainerInspect> {
    let exports: string[] = [];
    if (this.plugin) {
      try {
        const rawExports = await this.plugin.getExports();
        exports = rawExports
          .filter((e) => e.kind === "function")
          .map((e) => e.name);
      } catch {
        // ignore — return empty list
      }
    }
    return { id: this.id, config: this.config, exports, state: this.state };
  }

  async logs(limit = 100): Promise<LogEntry[]> {
    return this.logBuffer.slice(-limit).reverse();
  }

  async stats(): Promise<ContainerStats> {
    if (this.state.status !== "running") {
      throw new ContainerNotRunningError(this.id);
    }
    return {
      containerId: this.id,
      memoryUsageBytes: this.config.memoryLimitPages * 65536,
      callCount: this.callCount,
      uptimeMs: Date.now() - this.startedAtMs,
      sampledAt: new Date().toISOString(),
    };
  }

  getState(): ContainerState {
    return this.state;
  }

  setState(patch: Partial<ContainerState>): void {
    this.state = { ...this.state, ...patch };
  }

  appendLog(stream: "stdout" | "stderr", message: string): void {
    const entry: LogEntry = { timestamp: new Date().toISOString(), stream, message };
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxLogLines) {
      this.logBuffer.shift();
    }
  }
}

// ── ContainerRuntime ──────────────────────────────────────────────────────────

export class ContainerRuntime {
  private readonly containers = new Map<string, WasmContainer>();
  private readonly ociClient: OciClient;
  private readonly blobCache: BlobCache;

  constructor(options: ContainerRuntimeOptions = {}) {
    const cachePath = options.cachePath ?? path.join(os.homedir(), ".nexus", "cache");
    this.blobCache = new DiskBlobCache(cachePath);
    this.ociClient = new OciClient({
      blobCache: this.blobCache,
      platform: options.defaultPlatform,
    });
  }

  async create(config: ContainerConfig): Promise<WasmContainer> {
    const validated = ContainerConfigSchema.parse(config);
    const id = uuid();

    // Resolve wasm bytes from cache or pull
    const ref = parseImageRef(validated.image);
    let wasmBytes: Uint8Array | undefined;

    // Check cache first
    const manifest = await this.ociClient.pullManifest(ref);
    const wasmLayer = manifest.layers.find(
      (l) =>
        l.mediaType === MEDIA_TYPES.WASM ||
        l.mediaType === MEDIA_TYPES.OCI_LAYER_TAR ||
        l.mediaType === MEDIA_TYPES.OCI_LAYER_GZIP,
    ) ?? manifest.layers[0];

    const cached = await this.blobCache.get(wasmLayer.digest);
    if (cached) {
      wasmBytes = cached;
    } else {
      wasmBytes = await this.ociClient.pullBlob(ref.registry, ref.repository, wasmLayer);
    }

    const container = new WasmContainer(id, validated, wasmBytes);
    this.containers.set(id, container);
    log.info({ id, image: validated.image }, "Container created");
    return container;
  }

  get(id: string): WasmContainer | undefined {
    return this.containers.get(id);
  }

  list(): WasmContainer[] {
    return Array.from(this.containers.values());
  }

  async remove(id: string): Promise<void> {
    const container = this.containers.get(id);
    if (!container) throw new ContainerNotFoundError(id);
    await container.stop();
    this.containers.delete(id);
    log.info({ id }, "Container removed");
  }

  async pullImage(imageRef: string | ParsedImageRef): Promise<ParsedImageRef> {
    const ref = typeof imageRef === "string" ? parseImageRef(imageRef) : imageRef;
    const manifest = await this.ociClient.pullManifest(ref);

    for (const layer of manifest.layers) {
      await this.ociClient.pullBlob(ref.registry, ref.repository, layer);
    }

    log.info({ image: ref.original }, "Image pulled and cached");
    return ref;
  }
}
