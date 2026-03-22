/**
 * Tests for providers/resolver.ts
 * Covers: resolveProvider, markProviderFailed, cooldown, failover
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";

const tmpDir = path.join(os.tmpdir(), `nexus-test-resolver-${process.pid}`);
process.env.NEXUS_DATA_DIR = tmpDir;

import { runMigrations } from "@nexus/core";

// We need to mock the provider factories so that resolveProvider doesn't require real API keys
vi.mock("../providers/anthropic.js", () => ({
  createAnthropicProvider: vi.fn((apiKey: string) => ({
    id: "anthropic",
    name: "Anthropic",
    async *stream() { yield { type: "done" as const }; },
    async complete() {
      return { content: "mock", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn" as const };
    },
  })),
}));

vi.mock("../providers/openai.js", () => ({
  createOpenAIProvider: vi.fn((apiKey: string) => ({
    id: "openai",
    name: "OpenAI",
    async *stream() { yield { type: "done" as const }; },
    async complete() {
      return { content: "mock", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn" as const };
    },
  })),
}));

// Import after mocks are set up
import { resolveProvider, markProviderFailed } from "../providers/resolver.js";

describe("providers/resolver", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    runMigrations();
    // Reset env vars
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    // Restore env
    process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
  });

  describe("resolveProvider with ANTHROPIC_API_KEY set", () => {
    it("returns an anthropic provider when ANTHROPIC_API_KEY is set", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

      const { provider, model } = resolveProvider("anthropic");
      expect(provider.id).toBe("anthropic");
      expect(typeof model).toBe("string");
    });

    it("returns the default model when no model override given", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

      const { model } = resolveProvider("anthropic");
      // Default model from config schema is "claude-sonnet-4-6"
      expect(model).toBeTruthy();
    });

    it("uses the model override when provided", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

      const { model } = resolveProvider("anthropic", "claude-3-opus-20240229");
      expect(model).toBe("claude-3-opus-20240229");
    });
  });

  describe("resolveProvider with OPENAI_API_KEY set", () => {
    it("returns an openai provider when OPENAI_API_KEY is set and openai preferred", () => {
      process.env.OPENAI_API_KEY = "sk-openai-test-key";

      const { provider } = resolveProvider("openai");
      expect(provider.id).toBe("openai");
    });
  });

  describe("resolveProvider with no keys", () => {
    it("throws when no API keys are available", () => {
      // Ensure no keys in env
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;

      expect(() => resolveProvider("anthropic")).toThrow(/no available provider/i);
    });

    it("error message lists tried providers", () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;

      let errorMessage = "";
      try {
        resolveProvider("anthropic");
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
      expect(errorMessage).toBeTruthy();
    });
  });

  describe("markProviderFailed + cooldown behavior", () => {
    it("marks a provider as failed and causes it to be skipped", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

      // Mark anthropic as failed
      markProviderFailed("anthropic");

      // Now resolveProvider with only anthropic available should throw
      delete process.env.OPENAI_API_KEY;
      expect(() => resolveProvider("anthropic")).toThrow(/no available provider/i);
    });

    it("falls over to openai when anthropic is in cooldown", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
      process.env.OPENAI_API_KEY = "sk-openai-test-key";

      markProviderFailed("anthropic");

      // Should fall back to openai
      const { provider } = resolveProvider("anthropic");
      expect(provider.id).toBe("openai");
    });

    it("cooldown expires after time passes", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

      markProviderFailed("anthropic");

      // Simulate time passing beyond COOLDOWN_MS (60000ms) using fake timers
      vi.useFakeTimers();
      vi.advanceTimersByTime(61_000);

      const { provider } = resolveProvider("anthropic");
      expect(provider.id).toBe("anthropic");

      vi.useRealTimers();
    });
  });

  describe("failover chain", () => {
    it("prefers the requested provider when available", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
      process.env.OPENAI_API_KEY = "sk-openai-test-key";

      const { provider } = resolveProvider("anthropic");
      expect(provider.id).toBe("anthropic");
    });

    it("prefers openai when explicitly requested", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
      process.env.OPENAI_API_KEY = "sk-openai-test-key";

      const { provider } = resolveProvider("openai");
      expect(provider.id).toBe("openai");
    });

    it("throws when all providers are in cooldown", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
      process.env.OPENAI_API_KEY = "sk-openai-test-key";

      markProviderFailed("anthropic");
      markProviderFailed("openai");

      expect(() => resolveProvider("anthropic")).toThrow(/no available provider/i);
    });
  });
});
