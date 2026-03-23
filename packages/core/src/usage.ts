/**
 * Usage analytics — reads token counts from messages.metadata and aggregates
 * into summaries, per-session breakdowns, per-model breakdowns, and time series.
 *
 * messages.metadata JSON shape (written by runtime.ts):
 *   { usage: { inputTokens: number, outputTokens: number }, toolCallCount?: number }
 */
import { getDb } from "./db.js";

// ── Cost rates (per million tokens, USD) ────────────────────────────

const COST_RATES: Record<string, { input: number; output: number }> = {
  anthropic: { input: 3.0,  output: 15.0 },
  openai:    { input: 5.0,  output: 15.0 },
  default:   { input: 3.0,  output: 15.0 },
};

function estimateCost(provider: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_RATES[provider] ?? COST_RATES.default;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

// ── Public types ─────────────────────────────────────────────────────

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  sessionCount: number;
  messageCount: number;
}

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
  date: string;        // YYYY-MM-DD
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ── Row shapes ────────────────────────────────────────────────────────

interface MessageMetaRow {
  session_id: string;
  agent_id: string;
  metadata: string | null;
  created_at: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

function parseUsage(metadata: string | null): { inputTokens: number; outputTokens: number; model?: string; provider?: string } {
  if (!metadata) return { inputTokens: 0, outputTokens: 0 };
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const usage = parsed.usage as Record<string, unknown> | undefined;
    return {
      inputTokens: typeof usage?.inputTokens === "number" ? usage.inputTokens : 0,
      outputTokens: typeof usage?.outputTokens === "number" ? usage.outputTokens : 0,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      provider: typeof parsed.provider === "string" ? parsed.provider : undefined,
    };
  } catch {
    return { inputTokens: 0, outputTokens: 0 };
  }
}

// ── Public functions ──────────────────────────────────────────────────

export function getUsageSummary(): UsageSummary {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.session_id, s.agent_id, m.metadata
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE m.role = 'assistant'`,
    )
    .all() as MessageMetaRow[];

  let totalInput = 0, totalOutput = 0;
  for (const row of rows) {
    const u = parseUsage(row.metadata);
    totalInput += u.inputTokens;
    totalOutput += u.outputTokens;
  }

  const sessionCount = (
    db.prepare("SELECT COUNT(DISTINCT id) as c FROM sessions").get() as { c: number }
  ).c;

  const messageCount = (
    db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }
  ).c;

  return {
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalTokens: totalInput + totalOutput,
    estimatedCostUsd: estimateCost("default", totalInput, totalOutput),
    sessionCount,
    messageCount,
  };
}

export function getUsageBySession(limit = 50): SessionUsage[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.session_id, s.agent_id, m.metadata,
              COUNT(*) OVER (PARTITION BY m.session_id) as msg_count
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE m.role = 'assistant'
       ORDER BY m.session_id`,
    )
    .all() as Array<MessageMetaRow & { msg_count: number }>;

  const bySession = new Map<string, SessionUsage>();
  for (const row of rows) {
    const u = parseUsage(row.metadata);
    const existing = bySession.get(row.session_id);
    if (existing) {
      existing.inputTokens += u.inputTokens;
      existing.outputTokens += u.outputTokens;
      existing.totalTokens += u.inputTokens + u.outputTokens;
      existing.messageCount += 1;
    } else {
      bySession.set(row.session_id, {
        sessionId: row.session_id,
        agentId: row.agent_id,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        totalTokens: u.inputTokens + u.outputTokens,
        messageCount: 1,
      });
    }
  }

  return Array.from(bySession.values())
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, limit);
}

export function getUsageByModel(): ModelUsage[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT metadata FROM messages WHERE role = 'assistant'")
    .all() as Array<{ metadata: string | null }>;

  const byModel = new Map<string, ModelUsage>();
  for (const row of rows) {
    const u = parseUsage(row.metadata);
    const model = u.model ?? "unknown";
    const provider = u.provider ?? "default";
    const key = `${provider}::${model}`;
    const existing = byModel.get(key);
    if (existing) {
      existing.inputTokens += u.inputTokens;
      existing.outputTokens += u.outputTokens;
      existing.totalTokens += u.inputTokens + u.outputTokens;
      existing.messageCount += 1;
      existing.estimatedCostUsd = estimateCost(provider, existing.inputTokens, existing.outputTokens);
    } else {
      byModel.set(key, {
        model,
        provider,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        totalTokens: u.inputTokens + u.outputTokens,
        messageCount: 1,
        estimatedCostUsd: estimateCost(provider, u.inputTokens, u.outputTokens),
      });
    }
  }

  return Array.from(byModel.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}

export function getUsageTimeSeries(days = 30): DailyUsage[] {
  const db = getDb();
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const rows = db
    .prepare(
      `SELECT metadata, created_at
       FROM messages
       WHERE role = 'assistant' AND created_at >= ?
       ORDER BY created_at ASC`,
    )
    .all(since) as Array<{ metadata: string | null; created_at: number }>;

  const byDate = new Map<string, DailyUsage>();
  for (const row of rows) {
    const date = new Date(row.created_at * 1000).toISOString().slice(0, 10);
    const u = parseUsage(row.metadata);
    const existing = byDate.get(date);
    if (existing) {
      existing.inputTokens += u.inputTokens;
      existing.outputTokens += u.outputTokens;
      existing.totalTokens += u.inputTokens + u.outputTokens;
    } else {
      byDate.set(date, {
        date,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        totalTokens: u.inputTokens + u.outputTokens,
      });
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
