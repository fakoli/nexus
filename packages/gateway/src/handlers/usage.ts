/**
 * Usage analytics RPC handlers.
 *
 * - usage.summary    — overall token & cost stats
 * - usage.by-session — per-session token breakdown
 * - usage.by-model   — per-model token breakdown
 * - usage.timeseries — daily token counts
 */
import { z } from "zod";
import {
  getUsageSummary,
  getUsageBySession,
  getUsageByModel,
  getUsageTimeSeries,
  createLogger,
} from "@nexus/core";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:usage");

// ── Param schemas ─────────────────────────────────────────────────────

const BySessionParams = z.object({
  limit: z.number().int().positive().max(500).default(50),
});

const TimeSeriesParams = z.object({
  days: z.number().int().min(1).max(365).default(30),
});

// ── Handlers ──────────────────────────────────────────────────────────

export function handleUsageSummary(_params: Record<string, unknown>): ResponseFrame {
  try {
    const summary = getUsageSummary();
    log.info({ tokens: summary.totalTokens }, "Usage summary requested");
    return { id: "", ok: true, payload: { summary } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "", ok: false, error: { code: "INTERNAL_ERROR", message: msg } };
  }
}

export function handleUsageBySession(params: Record<string, unknown>): ResponseFrame {
  const parsed = BySessionParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  try {
    const sessions = getUsageBySession(parsed.data.limit);
    return { id: "", ok: true, payload: { sessions } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "", ok: false, error: { code: "INTERNAL_ERROR", message: msg } };
  }
}

export function handleUsageByModel(_params: Record<string, unknown>): ResponseFrame {
  try {
    const models = getUsageByModel();
    return { id: "", ok: true, payload: { models } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "", ok: false, error: { code: "INTERNAL_ERROR", message: msg } };
  }
}

export function handleUsageTimeSeries(params: Record<string, unknown>): ResponseFrame {
  const parsed = TimeSeriesParams.safeParse(params);
  if (!parsed.success) {
    return { id: "", ok: false, error: { code: "INVALID_PARAMS", message: parsed.error.message } };
  }
  try {
    const series = getUsageTimeSeries(parsed.data.days);
    return { id: "", ok: true, payload: { series } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: "", ok: false, error: { code: "INTERNAL_ERROR", message: msg } };
  }
}
