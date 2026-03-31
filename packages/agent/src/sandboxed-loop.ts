/**
 * Sandboxed execution loop — runs the agent turn cycle inside a sandbox.
 *
 * Instead of calling an LLM provider directly, this loop serialises messages
 * into the guest, collects tool-call requests from the response, executes
 * them through host functions, and feeds results back until no more tool
 * calls are emitted or maxRounds is reached.
 */
import { createLogger } from "@nexus/core";
import type { SandboxInstance } from "@nexus/sandbox";
import type { ProviderMessage } from "./providers/base.js";

const log = createLogger("agent:sandboxed-loop");

export interface SandboxedLoopOptions {
  sandbox: SandboxInstance;
  messages: ProviderMessage[];
  maxRounds?: number;
}

export interface SandboxedLoopResult {
  content: string;
  toolCallCount: number;
}

interface SandboxToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface SandboxResponse {
  content: string;
  toolCalls: SandboxToolCall[];
}

function parseSandboxResponse(raw: string): SandboxResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { content: raw, toolCalls: [] };
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "content" in parsed &&
    "toolCalls" in parsed &&
    Array.isArray((parsed as { toolCalls: unknown }).toolCalls)
  ) {
    return parsed as SandboxResponse;
  }

  return { content: raw, toolCalls: [] };
}

export async function runSandboxedLoop(
  options: SandboxedLoopOptions,
): Promise<SandboxedLoopResult> {
  const { sandbox, maxRounds = 20 } = options;
  let messages = [...options.messages];

  let finalContent = "";
  let toolCallCount = 0;

  for (let round = 0; round < maxRounds; round++) {
    const input = JSON.stringify({ messages });
    let rawResponse: string;

    try {
      rawResponse = await sandbox.call("handle_message", input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ sandboxId: sandbox.id, round, error: msg }, "Sandbox call failed");
      throw err;
    }

    const response = parseSandboxResponse(rawResponse);

    if (response.content) {
      finalContent = response.content;
    }

    // No tool calls → done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      log.info({ sandboxId: sandbox.id, round, toolCallCount }, "Sandboxed loop complete");
      break;
    }

    // Execute each tool call through the sandbox's host functions
    const toolResults: ProviderMessage[] = [];

    for (const call of response.toolCalls) {
      toolCallCount++;

      const toolInput = JSON.stringify({ name: call.name, input: call.input });
      let toolResult: string;

      try {
        toolResult = await sandbox.call("tool_execute", toolInput);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toolResult = JSON.stringify({ error: msg });
      }

      toolResults.push({
        role: "tool",
        content: toolResult,
        toolCallId: call.id,
        name: call.name,
      });
    }

    // Append assistant turn + tool results for the next round
    messages = [
      ...messages,
      {
        role: "assistant",
        content: response.content || `[tool_use: ${response.toolCalls.map((c) => c.name).join(", ")}]`,
      },
      ...toolResults,
    ];

    log.info({ sandboxId: sandbox.id, round, toolCalls: response.toolCalls.length }, "Sandbox tool round complete");
  }

  return { content: finalContent, toolCallCount };
}
