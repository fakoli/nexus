import { describe, it, expect, vi } from "vitest";
import { runSandboxedLoop } from "../sandboxed-loop.js";
import type { SandboxInstance } from "@nexus/sandbox";
import type { ProviderMessage } from "../providers/base.js";

function makeMockSandbox(responses: string[]): SandboxInstance {
  let callIndex = 0;
  return {
    id: "mock-sandbox-1",
    call: vi.fn().mockImplementation(() => {
      const response = responses[callIndex] ?? JSON.stringify({ content: "done", toolCalls: [] });
      callIndex++;
      return Promise.resolve(response);
    }),
    getMemoryUsage: vi.fn().mockReturnValue(1024),
    reset: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

const userMessage: ProviderMessage = { role: "user", content: "Hello" };

describe("runSandboxedLoop", () => {
  it("returns content from a single-round response", async () => {
    const sandbox = makeMockSandbox([
      JSON.stringify({ content: "Sandboxed reply", toolCalls: [] }),
    ]);
    const result = await runSandboxedLoop({ sandbox, messages: [userMessage] });
    expect(result.content).toBe("Sandboxed reply");
    expect(result.toolCallCount).toBe(0);
  });

  it("serialises messages into the sandbox call", async () => {
    const sandbox = makeMockSandbox([
      JSON.stringify({ content: "ok", toolCalls: [] }),
    ]);
    await runSandboxedLoop({ sandbox, messages: [userMessage] });
    const callSpy = sandbox.call as ReturnType<typeof vi.fn>;
    expect(callSpy).toHaveBeenCalledWith("handle_message", expect.stringContaining("Hello"));
  });

  it("executes tool calls via sandbox.call and loops", async () => {
    const toolCallResponse = JSON.stringify({
      content: "calling tool",
      toolCalls: [{ id: "call-1", name: "memory", input: { q: "test" } }],
    });
    const toolResultFeedback = JSON.stringify({ content: "final answer", toolCalls: [] });
    const sandbox = makeMockSandbox([
      toolCallResponse,
      JSON.stringify({ ok: true }), // tool_execute response
      toolResultFeedback,
    ]);

    const result = await runSandboxedLoop({ sandbox, messages: [userMessage] });
    expect(result.toolCallCount).toBe(1);
    expect(result.content).toBe("final answer");

    const callSpy = sandbox.call as ReturnType<typeof vi.fn>;
    // First call: handle_message, Second: tool_execute, Third: handle_message again
    expect(callSpy.mock.calls[1][0]).toBe("tool_execute");
  });

  it("stops after maxRounds when tool calls keep coming", async () => {
    // Always returns a tool call — loop should stop at maxRounds
    const alwaysTool = JSON.stringify({
      content: "tool again",
      toolCalls: [{ id: "call-x", name: "tool", input: {} }],
    });
    const toolResult = JSON.stringify({ ok: true });
    // Alternate: handle_message → tool_execute → handle_message → ...
    const responses: string[] = [];
    for (let i = 0; i < 50; i++) {
      responses.push(i % 2 === 0 ? alwaysTool : toolResult);
    }
    const sandbox = makeMockSandbox(responses);
    const result = await runSandboxedLoop({ sandbox, messages: [userMessage], maxRounds: 3 });
    // Should have stopped at 3 rounds, each with 1 tool call
    expect(result.toolCallCount).toBe(3);
  });

  it("handles malformed sandbox response gracefully", async () => {
    const sandbox = makeMockSandbox(["not-json"]);
    const result = await runSandboxedLoop({ sandbox, messages: [userMessage] });
    expect(result.content).toBe("not-json"); // falls back to raw string
    expect(result.toolCallCount).toBe(0);
  });

  it("propagates sandbox.call errors", async () => {
    const sandbox: SandboxInstance = {
      id: "error-sandbox",
      call: vi.fn().mockRejectedValue(new Error("sandbox crashed")),
      getMemoryUsage: vi.fn().mockReturnValue(0),
      reset: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    await expect(runSandboxedLoop({ sandbox, messages: [userMessage] })).rejects.toThrow("sandbox crashed");
  });
});
