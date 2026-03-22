/**
 * compaction.test.ts
 *
 * Tests for packages/agent/src/compaction.ts:
 *   - estimateTokens
 *   - shouldCompact
 *   - compactHistory (provider mocked)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Provider, ProviderMessage, ProviderResponse } from "../providers/base.js";
import { estimateTokens, shouldCompact, compactHistory, DEFAULT_MAX_TOKENS } from "../compaction.js";

// ── Mock provider factory ─────────────────────────────────────────────────────

function makeProvider(summaryText: string, shouldFail = false): Provider {
  return {
    id: "mock-compact",
    name: "MockCompact",
    async *stream() {
      yield { type: "done" as const };
    },
    async complete(): Promise<ProviderResponse> {
      if (shouldFail) throw new Error("LLM unavailable");
      return {
        content: summaryText,
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 20 },
        stopReason: "end_turn",
      };
    },
  };
}

function makeMessages(count: number, charsEach = 40): ProviderMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as ProviderMessage["role"],
    content: "x".repeat(charsEach),
  }));
}

// ── estimateTokens ────────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns 0 for an empty message list", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("estimates tokens as ceil(totalChars / 4)", () => {
    const messages: ProviderMessage[] = [
      { role: "user", content: "aaaa" },    // 4 chars
      { role: "assistant", content: "bb" }, // 2 chars
    ];
    // total = 6, ceil(6/4) = 2
    expect(estimateTokens(messages)).toBe(2);
  });

  it("handles a single message with 400 chars → 100 tokens", () => {
    const messages: ProviderMessage[] = [{ role: "user", content: "a".repeat(400) }];
    expect(estimateTokens(messages)).toBe(100);
  });

  it("accumulates content across all messages", () => {
    const messages = makeMessages(10, 40); // 10 * 40 = 400 chars → 100 tokens
    expect(estimateTokens(messages)).toBe(100);
  });

  it("returns 1 for a single-character message (ceil(1/4)=1)", () => {
    expect(estimateTokens([{ role: "user", content: "x" }])).toBe(1);
  });
});

// ── shouldCompact ─────────────────────────────────────────────────────────────

describe("shouldCompact", () => {
  it("returns false when estimated tokens are well below threshold", () => {
    const messages = makeMessages(2, 40); // 80 chars → 20 tokens; threshold=80_000
    expect(shouldCompact(messages, 100_000)).toBe(false);
  });

  it("returns true when estimated tokens exceed 80% of maxTokens", () => {
    // Need > 80_000 tokens → > 320_000 chars
    const messages: ProviderMessage[] = [
      { role: "user", content: "a".repeat(400_000) },
    ];
    expect(shouldCompact(messages, 100_000)).toBe(true);
  });

  it("returns false at exactly the threshold boundary (equal → not over)", () => {
    // threshold = floor(100 * 0.8) = 80 tokens → 320 chars
    const messages: ProviderMessage[] = [{ role: "user", content: "a".repeat(320) }];
    // estimateTokens = ceil(320/4) = 80; threshold = 80 → NOT exceeded
    expect(shouldCompact(messages, 100)).toBe(false);
  });

  it("returns true when one token over the threshold", () => {
    // 81 tokens > 80 threshold
    const messages: ProviderMessage[] = [{ role: "user", content: "a".repeat(324) }];
    // ceil(324/4) = 81 > 80
    expect(shouldCompact(messages, 100)).toBe(true);
  });

  it("uses DEFAULT_MAX_TOKENS for anthropic (100_000)", () => {
    expect(DEFAULT_MAX_TOKENS["anthropic"]).toBe(100_000);
  });

  it("uses DEFAULT_MAX_TOKENS for openai (128_000)", () => {
    expect(DEFAULT_MAX_TOKENS["openai"]).toBe(128_000);
  });
});

// ── compactHistory ────────────────────────────────────────────────────────────

describe("compactHistory", () => {
  it("returns messages unchanged when count <= 6 (RECENT_MESSAGES_TO_KEEP)", async () => {
    const provider = makeProvider("summary");
    const messages = makeMessages(4, 10);
    const result = await compactHistory(provider, "claude-test", messages);
    expect(result).toEqual(messages);
  });

  it("compacts when message count > 6 — result starts with a summary message", async () => {
    const provider = makeProvider("This is the summary.");
    const messages = makeMessages(10, 40);
    const result = await compactHistory(provider, "claude-test", messages);
    expect(result.length).toBeLessThan(messages.length);
    expect(result[0].content).toContain("This is the summary.");
  });

  it("keeps exactly the 6 most recent messages after the summary", async () => {
    const provider = makeProvider("compact summary");
    const messages = makeMessages(10, 40);
    const result = await compactHistory(provider, "claude-test", messages);
    // result = [summaryMsg, ...6 recent]  → length = 7
    expect(result.length).toBe(7);
  });

  it("summary message has role 'assistant'", async () => {
    const provider = makeProvider("summed up");
    const messages = makeMessages(8, 40);
    const result = await compactHistory(provider, "claude-test", messages);
    expect(result[0].role).toBe("assistant");
  });

  it("falls back to original messages when provider.complete throws", async () => {
    const failingProvider = makeProvider("", true);
    const messages = makeMessages(10, 40);
    const result = await compactHistory(failingProvider, "claude-test", messages);
    // Should return unmodified original
    expect(result).toEqual(messages);
  });

  it("uses '(summary unavailable)' when provider returns empty content", async () => {
    const provider = makeProvider("   "); // trimmed to empty
    const messages = makeMessages(10, 40);
    const result = await compactHistory(provider, "claude-test", messages);
    expect(result[0].content).toContain("(summary unavailable)");
  });
});
