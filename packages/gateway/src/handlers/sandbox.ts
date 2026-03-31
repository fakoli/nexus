/**
 * Sandbox RPC handlers.
 *
 * agents.sandbox.status — list active sandboxes with resource metrics
 * agents.sandbox.list   — list sandbox configuration per agent
 */
import { z } from "zod";
import { createLogger } from "@nexus/core";
import { SandboxPool, SandboxMonitor, InProcessRuntime, CAPABILITY_PROFILES } from "@nexus/sandbox";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:sandbox");

// ── Shared sandbox state (singleton per gateway process) ────────────

export const defaultRuntime = new InProcessRuntime();
export const defaultPool = new SandboxPool({ runtime: defaultRuntime, maxInstances: 10 });
export const defaultMonitor = new SandboxMonitor({ checkIntervalMs: 10000 });

// ── Param schemas ───────────────────────────────────────────────────

const SandboxStatusParams = z.object({
  agentId: z.string().optional(),
});

const SandboxListParams = z.object({
  agentId: z.string().optional(),
});

// ── Helpers ─────────────────────────────────────────────────────────

function invalidParams(message: string): ResponseFrame {
  return { id: "", ok: false, error: { code: "INVALID_PARAMS", message } };
}

// ── Handlers ────────────────────────────────────────────────────────

export function handleSandboxStatus(params: Record<string, unknown>): ResponseFrame {
  const parsed = SandboxStatusParams.safeParse(params);
  if (!parsed.success) return invalidParams(parsed.error.message);

  const allMetrics = defaultMonitor.getMetrics();
  const metrics = parsed.data.agentId
    ? allMetrics.filter((m) => m.agentId === parsed.data.agentId)
    : allMetrics;

  log.debug({ count: metrics.length }, "Sandbox status requested");

  return {
    id: "",
    ok: true,
    payload: {
      sandboxes: metrics,
      activeCount: defaultPool.activeCount,
      totalCount: defaultPool.totalCount,
      monitorRunning: defaultMonitor.isRunning,
    },
  };
}

export function handleSandboxList(params: Record<string, unknown>): ResponseFrame {
  const parsed = SandboxListParams.safeParse(params);
  if (!parsed.success) return invalidParams(parsed.error.message);

  log.debug({ agentId: parsed.data.agentId }, "Sandbox list requested");

  // Return available capability profiles as the public configuration surface
  const profiles = Object.entries(CAPABILITY_PROFILES).map(([name, caps]) => ({
    name,
    capabilities: caps,
  }));

  return {
    id: "",
    ok: true,
    payload: {
      profiles,
      agentId: parsed.data.agentId ?? null,
      activeCount: defaultPool.activeCount,
    },
  };
}
