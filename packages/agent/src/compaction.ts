/**
 * Context compaction — token estimation and history summarisation.
 *
 * Prevents context-window overflow by detecting when history is getting long
 * and summarising older messages into a single condensed entry.
 *
 * Strategy: rough char/4 estimate → if > 80 % of budget → call LLM to
 * summarise everything except the last few turns → replace with summary.
 */
import { createLogger } from "@nexus/core";
import type { Provider, ProviderMessage } from "./providers/base.js";

const log = createLogger("agent:compaction");

/** Characters-per-token approximation (conservative). */
const CHARS_PER_TOKEN = 4;

/** Keep the most recent N messages verbatim after compaction. */
const RECENT_MESSAGES_TO_KEEP = 6;

/** Fraction of budget that triggers compaction. */
const COMPACT_THRESHOLD = 0.8;

/** Default token budgets by provider family. */
export const DEFAULT_MAX_TOKENS: Record<string, number> = {
  anthropic: 100_000,
  openai: 128_000,
  default: 100_000,
};

// ── Estimation ────────────────────────────────────────────────────────────────

export function estimateTokens(messages: ProviderMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

// ── Compaction trigger ────────────────────────────────────────────────────────

export function shouldCompact(messages: ProviderMessage[], maxTokens: number): boolean {
  const estimated = estimateTokens(messages);
  const threshold = Math.floor(maxTokens * COMPACT_THRESHOLD);
  if (estimated > threshold) {
    log.debug({ estimated, threshold, maxTokens }, "Compaction threshold exceeded");
    return true;
  }
  return false;
}

// ── Summarisation ─────────────────────────────────────────────────────────────

/**
 * Summarises the older portion of `messages` with a single cheap LLM call.
 * Returns a new message list: [summary-assistant-msg, ...recent].
 */
export async function compactHistory(
  provider: Provider,
  model: string,
  messages: ProviderMessage[],
): Promise<ProviderMessage[]> {
  if (messages.length <= RECENT_MESSAGES_TO_KEEP) {
    return messages;
  }

  const toSummarise = messages.slice(0, messages.length - RECENT_MESSAGES_TO_KEEP);
  const recent = messages.slice(messages.length - RECENT_MESSAGES_TO_KEEP);

  const summaryPrompt =
    "Summarise the following conversation history concisely. " +
    "Preserve key facts, decisions, and any code or tool results that may be referenced later. " +
    "Output plain text only — no markdown headers.\n\n" +
    toSummarise.map((m) => `[${m.role}]: ${m.content}`).join("\n");

  log.info(
    { messagesToSummarise: toSummarise.length, recentKept: recent.length },
    "Compacting history",
  );

  let summary: string;
  try {
    const response = await provider.complete({
      model,
      messages: [{ role: "user", content: summaryPrompt }],
      maxTokens: 1024,
    });
    summary = response.content.trim() || "(summary unavailable)";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ error: msg }, "Compaction LLM call failed — keeping full history");
    return messages;
  }

  const summaryMessage: ProviderMessage = {
    role: "assistant",
    content: `[Conversation summary — earlier history compacted]\n${summary}`,
  };

  log.info({ summaryLength: summary.length }, "History compacted");
  return [summaryMessage, ...recent];
}
