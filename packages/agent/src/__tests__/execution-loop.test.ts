/**
 * Tests for execution-loop.ts
 * Covers: simple response, tool call cycle, max rounds, provider failure
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";

const tmpDir = path.join(os.tmpdir(), `nexus-test-exec-loop-${process.pid}`);
process.env.NEXUS_DATA_DIR = tmpDir;

import { runMigrations, getOrCreateAgent, getOrCreateSession } from "@nexus/core";
import type { Provider, ProviderResponse } from "../providers/base.js";
import { runExecutionLoop } from "../execution-loop.js";
import { registerTool } from "../tool-executor.js";

// Suppress markProviderFailed side effects in the resolver module
vi.mock("../providers/resolver.js", () => ({
  markProviderFailed: vi.fn(),
  resolveProvider: vi.fn(),
}));

let sessionCounter = 0;
function uniqueSession(): string {
  return `loop-session-${process.pid}-${++sessionCounter}`;
}

function makeProvider(responses: Partial<ProviderResponse>[]): Provider {
  let callIndex = 0;
  return {
    id: "mock",
    name: "Mock",
    async *stream() {
      yield { type: "done" as const };
    },
    async complete(): Promise<ProviderResponse> {
      const base: ProviderResponse = {
        content: "test response",
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: "end_turn",
      };
      const override = responses[callIndex] ?? {};
      callIndex++;
      return { ...base, ...override };
    },
  };
}

describe("execution-loop", () => {
  beforeEach(() => {
    runMigrations();
    getOrCreateAgent("default");
  });

  describe("simple response (no tool calls)", () => {
    it("returns content from the provider", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      const provider = makeProvider([{ content: "Hello world", toolCalls: [], stopReason: "end_turn" }]);
      const result = await runExecutionLoop({
        provider,
        model: "test-model",
        sessionId,
        systemPrompt: "You are helpful.",
        messages: [{ role: "user", content: "Hi" }],
        tools: [],
      });

      expect(result.content).toBe("Hello world");
      expect(result.toolCallCount).toBe(0);
    });

    it("accumulates usage tokens", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      const provider = makeProvider([
        { content: "ok", toolCalls: [], stopReason: "end_turn", usage: { inputTokens: 100, outputTokens: 50 } },
      ]);
      const result = await runExecutionLoop({
        provider,
        model: "test-model",
        sessionId,
        systemPrompt: "sys",
        messages: [],
        tools: [],
      });

      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
    });

    it("calls onText callback with content", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      const textChunks: string[] = [];
      const provider = makeProvider([{ content: "streamed text", toolCalls: [], stopReason: "end_turn" }]);
      await runExecutionLoop({
        provider,
        model: "test-model",
        sessionId,
        systemPrompt: "sys",
        messages: [],
        tools: [],
        onText: (t) => textChunks.push(t),
      });

      expect(textChunks).toContain("streamed text");
    });
  });

  describe("tool call cycle", () => {
    it("executes tool calls and feeds result back", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      // Register a tool that will be called
      registerTool({
        name: "loop_test_tool",
        description: "Test tool",
        parameters: { type: "object", properties: {} },
        execute: async () => "tool output",
      });

      // First response has a tool call; second has no tool calls (done)
      const provider = makeProvider([
        {
          content: "",
          toolCalls: [{ id: "tc-1", name: "loop_test_tool", input: {} }],
          stopReason: "tool_use",
          usage: { inputTokens: 10, outputTokens: 5 },
        },
        {
          content: "Final answer",
          toolCalls: [],
          stopReason: "end_turn",
          usage: { inputTokens: 20, outputTokens: 8 },
        },
      ]);

      const toolCalls: string[] = [];
      const toolResults: string[] = [];

      const result = await runExecutionLoop({
        provider,
        model: "test-model",
        sessionId,
        systemPrompt: "sys",
        messages: [{ role: "user", content: "Use the tool" }],
        tools: [],
        onToolCall: (c) => toolCalls.push(c.name),
        onToolResult: (id, r) => toolResults.push(r),
      });

      expect(result.toolCallCount).toBe(1);
      expect(toolCalls).toContain("loop_test_tool");
      expect(toolResults).toContain("tool output");
      expect(result.content).toBe("Final answer");
    });

    it("accumulates tokens across multiple rounds", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      registerTool({
        name: "loop_multi_tool",
        description: "Multi round tool",
        parameters: { type: "object", properties: {} },
        execute: async () => "round result",
      });

      const provider = makeProvider([
        {
          content: "",
          toolCalls: [{ id: "tc-a", name: "loop_multi_tool", input: {} }],
          stopReason: "tool_use",
          usage: { inputTokens: 10, outputTokens: 5 },
        },
        {
          content: "done",
          toolCalls: [],
          stopReason: "end_turn",
          usage: { inputTokens: 20, outputTokens: 10 },
        },
      ]);

      const result = await runExecutionLoop({
        provider,
        model: "test-model",
        sessionId,
        systemPrompt: "sys",
        messages: [],
        tools: [],
      });

      expect(result.usage.inputTokens).toBe(30);
      expect(result.usage.outputTokens).toBe(15);
    });

    it("stops if provider returns tool calls but stopReason is end_turn", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      const provider = makeProvider([
        {
          content: "answer",
          // toolCalls present but stopReason is end_turn -> should NOT process tools
          toolCalls: [{ id: "tc-skip", name: "some_tool", input: {} }],
          stopReason: "end_turn",
          usage: { inputTokens: 5, outputTokens: 3 },
        },
      ]);

      const toolCalls: string[] = [];
      const result = await runExecutionLoop({
        provider,
        model: "test-model",
        sessionId,
        systemPrompt: "sys",
        messages: [],
        tools: [],
        onToolCall: (c) => toolCalls.push(c.name),
      });

      // Should not call the tool because stopReason != tool_use
      expect(toolCalls).toHaveLength(0);
      expect(result.content).toBe("answer");
    });
  });

  describe("max tool rounds", () => {
    it("breaks out of loop after MAX_TOOL_ROUNDS even if provider keeps returning tool calls", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      registerTool({
        name: "loop_infinite_tool",
        description: "Loops forever",
        parameters: { type: "object", properties: {} },
        execute: async () => "looping",
      });

      // Always return a tool call — loop should cap at 20 rounds
      const infiniteProvider: Provider = {
        id: "mock-infinite",
        name: "MockInfinite",
        async *stream() { yield { type: "done" as const }; },
        async complete(): Promise<ProviderResponse> {
          return {
            content: "",
            toolCalls: [{ id: `tc-inf-${Date.now()}`, name: "loop_infinite_tool", input: {} }],
            stopReason: "tool_use",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
      };

      const result = await runExecutionLoop({
        provider: infiniteProvider,
        model: "test-model",
        sessionId,
        systemPrompt: "sys",
        messages: [],
        tools: [],
      });

      // MAX_TOOL_ROUNDS is 20; toolCallCount should be capped at 20
      expect(result.toolCallCount).toBeLessThanOrEqual(20);
    });
  });

  describe("provider failure", () => {
    it("throws when provider.complete rejects", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      const failingProvider: Provider = {
        id: "mock-fail",
        name: "MockFail",
        async *stream() { yield { type: "done" as const }; },
        async complete(): Promise<ProviderResponse> {
          throw new Error("Provider is down");
        },
      };

      await expect(
        runExecutionLoop({
          provider: failingProvider,
          model: "test-model",
          sessionId,
          systemPrompt: "sys",
          messages: [],
          tools: [],
        }),
      ).rejects.toThrow("Provider is down");
    });

    it("calls markProviderFailed when provider throws", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      const { markProviderFailed } = await import("../providers/resolver.js");

      const failingProvider: Provider = {
        id: "mock-fail-track",
        name: "MockFailTrack",
        async *stream() { yield { type: "done" as const }; },
        async complete(): Promise<ProviderResponse> {
          throw new Error("Network error");
        },
      };

      await expect(
        runExecutionLoop({
          provider: failingProvider,
          model: "test-model",
          sessionId,
          systemPrompt: "sys",
          messages: [],
          tools: [],
        }),
      ).rejects.toThrow();

      expect(markProviderFailed).toHaveBeenCalledWith("mock-fail-track");
    });
  });
});
