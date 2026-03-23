import { gateway, setStore } from "./app";
import type { UsageSummary } from "../gateway/types";

// ── Local types matching core/src/usage.ts return shapes ─────────────────────

export type CoreUsageSummary = UsageSummary & {
  totalInputTokens?: number;
  totalOutputTokens?: number;
  estimatedCostUsd?: number;
  sessionCount?: number;
  messageCount?: number;
};

export interface SessionUsage {
  sessionId: string;
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  messageCount: number;
}

export interface ModelUsage {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  messageCount: number;
  estimatedCostUsd: number;
}

export interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ── loadUsageSummary ──────────────────────────────────────────────────────────

export async function loadUsageSummary(): Promise<CoreUsageSummary | null> {
  try {
    const payload = await gateway.request("usage.summary", {});
    // Gateway may wrap in { summary: ... } or return the object directly
    const summary = ((payload.summary ?? payload) as CoreUsageSummary);
    setStore("usage", "summary", {
      totalTokens: summary.totalTokens,
      totalCost: summary.totalCost ?? summary.estimatedCostUsd ?? 0,
      totalRequests: summary.totalRequests ?? summary.messageCount ?? 0,
      byModel: summary.byModel ?? {},
      periodStart: summary.periodStart ?? 0,
      periodEnd: summary.periodEnd ?? Date.now(),
    });
    return summary;
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
    return null;
  }
}

// ── loadUsageBySession ────────────────────────────────────────────────────────

export async function loadUsageBySession(): Promise<SessionUsage[]> {
  try {
    const payload = await gateway.request("usage.by-session", {});
    return (payload.sessions as SessionUsage[] | undefined) ?? [];
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
    return [];
  }
}

// ── loadUsageByModel ──────────────────────────────────────────────────────────

export async function loadUsageByModel(): Promise<ModelUsage[]> {
  try {
    const payload = await gateway.request("usage.by-model", {});
    return (payload.models as ModelUsage[] | undefined) ?? [];
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
    return [];
  }
}

// ── loadUsageTimeSeries ───────────────────────────────────────────────────────

export async function loadUsageTimeSeries(): Promise<DailyUsage[]> {
  try {
    const payload = await gateway.request("usage.timeseries", {});
    // Gateway returns { series: DailyUsage[] }; tests may mock as { days: [...] }
    return ((payload.series ?? payload.days) as DailyUsage[] | undefined) ?? [];
  } catch (err) {
    setStore("connection", "error", (err as Error).message);
    return [];
  }
}
