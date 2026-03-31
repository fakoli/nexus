/**
 * Container RPC handlers — OCI/Wasm container management.
 */
import { z } from "zod";
import { createLogger } from "@nexus/core";
import { LifecycleManager, ContainerConfigSchema, parseImageRef } from "@nexus/container";
import type { ContainerConfig } from "@nexus/container";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:container");

// ── Singleton lifecycle manager ──────────────────────────────────────────────

let manager: LifecycleManager | null = null;

function getManager(): LifecycleManager {
  if (!manager) {
    manager = new LifecycleManager({ maxLogLines: 10000 });
  }
  return manager;
}

/**
 * Gracefully shut down the module-level LifecycleManager.
 * Called by the gateway's close() method to avoid resource leaks.
 */
export async function shutdownContainerManager(): Promise<void> {
  if (manager) {
    await manager.shutdown();
    manager = null;
  }
}

// ── Param schemas ────────────────────────────────────────────────────────────

const ContainerRunParams = z.object({
  image: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  volumes: z
    .array(z.object({ hostPath: z.string(), guestPath: z.string(), readOnly: z.boolean().optional() }))
    .optional(),
  allowedHosts: z.array(z.string()).optional(),
  memoryLimitPages: z.number().int().optional(),
  timeoutMs: z.number().int().optional(),
  restartPolicy: z
    .union([
      z.object({ mode: z.literal("never") }),
      z.object({ mode: z.literal("always") }),
      z.object({ mode: z.literal("on-failure"), maxRetries: z.number().int().optional() }),
    ])
    .optional(),
  healthCheck: z
    .object({
      functionName: z.string().optional(),
      intervalMs: z.number().int().optional(),
      timeoutMs: z.number().int().optional(),
      retries: z.number().int().optional(),
      startPeriodMs: z.number().int().optional(),
    })
    .optional(),
  name: z.string().optional(),
});

const ContainerIdParams = z.object({
  containerId: z.string().min(1),
});

const ContainerLogsParams = z.object({
  containerId: z.string().min(1),
  limit: z.number().int().min(1).max(10000).default(100),
});

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function handleContainerRun(params: Record<string, unknown>): Promise<ResponseFrame> {
  const parsed = ContainerRunParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }

  // Validate image ref before attempting to pull
  try {
    parseImageRef(parsed.data.image);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "", ok: false, error: { code: "INVALID_IMAGE_REF", message: msg } };
  }

  const configResult = ContainerConfigSchema.safeParse(parsed.data);
  if (!configResult.success) {
    return { id: "", ok: false, error: { code: "INVALID_CONFIG", message: configResult.error.message } };
  }

  try {
    const result = await getManager().start(configResult.data as ContainerConfig);
    return { id: "", ok: true, payload: result };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, image: parsed.data.image }, "Container run failed");
    return { id: "", ok: false, error: { code: "CONTAINER_START_FAILED", message: msg } };
  }
}

export async function handleContainerStop(params: Record<string, unknown>): Promise<ResponseFrame> {
  const parsed = ContainerIdParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }

  try {
    await getManager().stop(parsed.data.containerId);
    return { id: "", ok: true, payload: { stopped: true } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "", ok: false, error: { code: "CONTAINER_STOP_FAILED", message: msg } };
  }
}

export function handleContainerList(_params: Record<string, unknown>): ResponseFrame {
  const mgr = getManager();
  const ids = mgr.listContainerIds();
  const containers = ids.map((id) => {
    const state = mgr.getState(id);
    return { containerId: id, state };
  });
  return { id: "", ok: true, payload: { containers, count: containers.length } };
}

export async function handleContainerInspect(params: Record<string, unknown>): Promise<ResponseFrame> {
  const parsed = ContainerIdParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }

  const entry = getManager().getManagedEntry(parsed.data.containerId);
  if (!entry) {
    return { id: "", ok: false, error: { code: "NOT_FOUND", message: "Container not found" } };
  }

  try {
    const inspect = await entry.container.inspect();
    const healthState = getManager().getHealthState(parsed.data.containerId);
    return { id: "", ok: true, payload: { ...inspect, healthState } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "", ok: false, error: { code: "INSPECT_FAILED", message: msg } };
  }
}

export async function handleContainerLogs(params: Record<string, unknown>): Promise<ResponseFrame> {
  const parsed = ContainerLogsParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }

  try {
    const logs = await getManager().getLogs(parsed.data.containerId, parsed.data.limit);
    return { id: "", ok: true, payload: { logs, count: logs.length } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "", ok: false, error: { code: "LOGS_FAILED", message: msg } };
  }
}

export async function handleContainerRemove(params: Record<string, unknown>): Promise<ResponseFrame> {
  const parsed = ContainerIdParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }

  try {
    await getManager().stop(parsed.data.containerId);
    return { id: "", ok: true, payload: { removed: true } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "", ok: false, error: { code: "REMOVE_FAILED", message: msg } };
  }
}
