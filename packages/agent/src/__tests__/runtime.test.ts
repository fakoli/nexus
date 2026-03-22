/**
 * Tests for runtime.ts (runAgent)
 * Covers: successful run, provider failure path, tool call count, message persistence
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";

const tmpDir = path.join(os.tmpdir(), `nexus-test-runtime-${process.pid}`);
process.env.NEXUS_DATA_DIR = tmpDir;

import { runMigrations, getOrCreateAgent, getOrCreateSession, getMessages } from "@nexus/core";
import type { Provider, ProviderResponse } from "../providers/base.js";

// Mock provider factories so resolveProvider doesn't need real API keys
vi.mock("../providers/anthropic.js", () => ({
  createAnthropicProvider: vi.fn(() => ({
    id: "anthropic",
    name: "Anthropic",
    async *stream() { yield { type: "done" as const }; },
    async complete(): Promise<ProviderResponse> {
      return {
        content: "Hello from mock anthropic",
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: "end_turn",
      };
    },
  })),
}));

vi.mock("../providers/openai.js", () => ({
  createOpenAIProvider: vi.fn(() => ({
    id: "openai",
    name: "OpenAI",
    async *stream() { yield { type: "done" as const }; },
    async complete(): Promise<ProviderResponse> {
      return {
        content: "Hello from mock openai",
        toolCalls: [],
        usage: { inputTokens: 8, outputTokens: 4 },
        stopReason: "end_turn",
      };
    },
  })),
}));

import { runAgent } from "../runtime.js";

let sessionCounter = 0;
function uniqueSession(): string {
  return `runtime-session-${process.pid}-${++sessionCounter}`;
}

describe("runtime / runAgent", () => {
  beforeEach(() => {
    runMigrations();
    getOrCreateAgent("default");
    process.env.ANTHROPIC_API_KEY = "sk-ant-mock-key";
  });

  describe("successful run", () => {
    it("returns content from the provider", async () => {
      const sessionId = uniqueSession();
      const result = await runAgent({
        sessionId,
        userMessage: "Hello",
      });

      expect(result.content).toBe("Hello from mock anthropic");
      expect(result.sessionId).toBe(sessionId);
    });

    it("returns a valid messageId (positive integer)", async () => {
      const sessionId = uniqueSession();
      const result = await runAgent({ sessionId, userMessage: "Test" });
      expect(typeof result.messageId).toBe("number");
      expect(result.messageId).toBeGreaterThan(0);
    });

    it("returns usage stats", async () => {
      const sessionId = uniqueSession();
      const result = await runAgent({ sessionId, userMessage: "Usage test" });
      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(5);
    });

    it("persists the user message to the session", async () => {
      const sessionId = uniqueSession();
      await runAgent({ sessionId, userMessage: "Persistent hello" });

      const messages = getMessages(sessionId);
      const userMsg = messages.find((m) => m.role === "user" && m.content === "Persistent hello");
      expect(userMsg).toBeDefined();
    });

    it("persists the assistant response to the session", async () => {
      const sessionId = uniqueSession();
      await runAgent({ sessionId, userMessage: "Hi agent" });

      const messages = getMessages(sessionId);
      const assistantMsg = messages.find(
        (m) => m.role === "assistant" && m.content === "Hello from mock anthropic",
      );
      expect(assistantMsg).toBeDefined();
    });

    it("calls onText callback with the response content", async () => {
      const sessionId = uniqueSession();
      const textChunks: string[] = [];
      await runAgent({
        sessionId,
        userMessage: "Callback test",
        onText: (t) => textChunks.push(t),
      });

      expect(textChunks).toContain("Hello from mock anthropic");
    });

    it("returns zero toolCallCount when no tools are used", async () => {
      const sessionId = uniqueSession();
      const result = await runAgent({ sessionId, userMessage: "No tools" });
      expect(result.toolCallCount).toBe(0);
    });

    it("uses a custom system prompt when provided", async () => {
      const sessionId = uniqueSession();
      // Just confirm it doesn't throw
      const result = await runAgent({
        sessionId,
        userMessage: "Custom sys",
        systemPrompt: "You are a test bot.",
      });
      expect(result.content).toBeTruthy();
    });

    it("accepts an explicit agentId", async () => {
      getOrCreateAgent("custom-agent");
      const sessionId = uniqueSession();
      const result = await runAgent({
        sessionId,
        agentId: "custom-agent",
        userMessage: "Agent test",
      });
      expect(result.sessionId).toBe(sessionId);
    });
  });

  describe("provider failure", () => {
    it("returns an error content string when the provider throws", async () => {
      // Override the mock to throw
      const { createAnthropicProvider } = await import("../providers/anthropic.js");
      vi.mocked(createAnthropicProvider).mockReturnValueOnce({
        id: "anthropic",
        name: "Anthropic",
        async *stream() { yield { type: "done" as const }; },
        async complete(): Promise<ProviderResponse> {
          throw new Error("Connection refused");
        },
      });

      const sessionId = uniqueSession();
      const result = await runAgent({ sessionId, userMessage: "Fail test" });

      expect(result.content).toMatch(/error/i);
      expect(result.content).toContain("Connection refused");
    });

    it("still returns a messageId on provider failure", async () => {
      const { createAnthropicProvider } = await import("../providers/anthropic.js");
      vi.mocked(createAnthropicProvider).mockReturnValueOnce({
        id: "anthropic",
        name: "Anthropic",
        async *stream() { yield { type: "done" as const }; },
        async complete(): Promise<ProviderResponse> {
          throw new Error("Timeout");
        },
      });

      const sessionId = uniqueSession();
      const result = await runAgent({ sessionId, userMessage: "Timeout test" });

      expect(typeof result.messageId).toBe("number");
      expect(result.messageId).toBeGreaterThan(0);
    });

    it("returns zero usage on provider failure when no fallback exists", async () => {
      // Remove both keys so no provider is available at all — resolver throws immediately
      // before any LLM call, so runAgent catches it and returns 0 usage.
      const savedAnthropic = process.env.ANTHROPIC_API_KEY;
      const savedOpenAI = process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        const sessionId = uniqueSession();
        const result = await runAgent({ sessionId, userMessage: "Zero usage test" });

        expect(result.usage.inputTokens).toBe(0);
        expect(result.usage.outputTokens).toBe(0);
        expect(result.content).toMatch(/error/i);
      } finally {
        if (savedAnthropic) process.env.ANTHROPIC_API_KEY = savedAnthropic;
        if (savedOpenAI) process.env.OPENAI_API_KEY = savedOpenAI;
      }
    });
  });
});
