/**
 * Tests for context-builder.ts
 * Covers: buildContext with empty/populated sessions, default/custom system prompts
 */
import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";

const tmpDir = path.join(os.tmpdir(), `nexus-test-ctx-${process.pid}`);
process.env.NEXUS_DATA_DIR = tmpDir;

import { runMigrations, getOrCreateSession, getOrCreateAgent, appendMessage, closeDb } from "@nexus/core";
import { buildContext } from "../context-builder.js";

// Use unique session IDs per test to avoid cross-test interference
let sessionCounter = 0;
function uniqueSession(): string {
  return `ctx-session-${process.pid}-${++sessionCounter}`;
}

describe("context-builder", () => {
  beforeEach(() => {
    runMigrations();
    getOrCreateAgent("default");
  });

  describe("buildContext with empty session", () => {
    it("returns empty messages array when session has no history", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      const ctx = await buildContext({ sessionId });
      expect(ctx.messages).toEqual([]);
    });

    it("returns empty tools array when no tools provided", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      const ctx = await buildContext({ sessionId });
      expect(ctx.tools).toEqual([]);
    });

    it("returns the default system prompt when none specified", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      const ctx = await buildContext({ sessionId });
      expect(ctx.systemPrompt).toContain("Nexus");
      expect(ctx.systemPrompt).toContain("helpful");
    });
  });

  describe("buildContext with messages in history", () => {
    it("includes user messages from history", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");
      appendMessage(sessionId, "user", "Hello there");

      const ctx = await buildContext({ sessionId });
      const userMsg = ctx.messages.find((m) => m.role === "user" && m.content === "Hello there");
      expect(userMsg).toBeDefined();
    });

    it("includes assistant messages from history", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");
      appendMessage(sessionId, "user", "Hi");
      appendMessage(sessionId, "assistant", "Hello, how can I help?");

      const ctx = await buildContext({ sessionId });
      const asstMsg = ctx.messages.find(
        (m) => m.role === "assistant" && m.content === "Hello, how can I help?",
      );
      expect(asstMsg).toBeDefined();
    });

    it("preserves message order (user then assistant)", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");
      appendMessage(sessionId, "user", "First");
      appendMessage(sessionId, "assistant", "Second");
      appendMessage(sessionId, "user", "Third");

      const ctx = await buildContext({ sessionId });
      const contents = ctx.messages.map((m) => m.content);
      expect(contents.indexOf("First")).toBeLessThan(contents.indexOf("Second"));
      expect(contents.indexOf("Second")).toBeLessThan(contents.indexOf("Third"));
    });

    it("respects maxHistoryMessages limit", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");
      for (let i = 0; i < 10; i++) {
        appendMessage(sessionId, "user", `message ${i}`);
      }

      const ctx = await buildContext({ sessionId, maxHistoryMessages: 3 });
      expect(ctx.messages.length).toBeLessThanOrEqual(3);
    });

    it("maps tool_use role to assistant role in messages", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");
      appendMessage(sessionId, "tool_use", JSON.stringify({ id: "c1", name: "bash", input: {} }), {
        toolCallId: "c1",
        toolName: "bash",
      });

      const ctx = await buildContext({ sessionId });
      const toolMsg = ctx.messages.find((m) => m.role === "assistant");
      expect(toolMsg).toBeDefined();
    });

    it("maps tool_result role to tool role in messages", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");
      appendMessage(sessionId, "tool_result", "output data", {
        toolCallId: "c1",
        toolName: "bash",
      });

      const ctx = await buildContext({ sessionId });
      const toolMsg = ctx.messages.find((m) => m.role === "tool");
      expect(toolMsg).toBeDefined();
    });
  });

  describe("system prompt", () => {
    it("uses the default system prompt when none provided", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");

      const ctx = await buildContext({ sessionId });
      expect(typeof ctx.systemPrompt).toBe("string");
      expect(ctx.systemPrompt.length).toBeGreaterThan(0);
    });

    it("uses a custom system prompt when provided", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");
      const custom = "You are a specialized coding assistant.";

      const ctx = await buildContext({ sessionId, systemPrompt: custom });
      expect(ctx.systemPrompt).toBe(custom);
    });

    it("does not use the default when a custom prompt is given", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");
      const custom = "Custom only prompt.";

      const ctx = await buildContext({ sessionId, systemPrompt: custom });
      expect(ctx.systemPrompt).not.toContain("Nexus");
    });
  });

  describe("tools passthrough", () => {
    it("passes provided tools into the context unchanged", async () => {
      const sessionId = uniqueSession();
      getOrCreateSession(sessionId, "default");
      const tools = [
        {
          name: "my_tool",
          description: "Does something",
          parameters: { type: "object", properties: {} },
        },
      ];

      const ctx = await buildContext({ sessionId, tools });
      expect(ctx.tools).toEqual(tools);
    });
  });
});
