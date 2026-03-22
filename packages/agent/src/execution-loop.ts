/**
 * Execution loop — the core agent request/tool/response cycle.
 *
 * This is the heart of the agent: send messages to LLM, handle tool calls,
 * accumulate responses. Under 200 LOC — compare to OpenClaw's 3,212-line attempt.ts.
 *
 * Flow: messages → LLM → (tool calls → execute → feed back) → final response
 */
import { createLogger, appendMessage } from "@nexus/core";
import type { Provider, ProviderMessage, ProviderResponse, ToolDefinition, ToolCall } from "./providers/base.js";
import { executeTool } from "./tool-executor.js";
import { markProviderFailed } from "./providers/resolver.js";

const log = createLogger("agent:loop");
const MAX_TOOL_ROUNDS = 20;

export interface ExecutionOptions {
  provider: Provider;
  model: string;
  sessionId: string;
  systemPrompt: string;
  messages: ProviderMessage[];
  tools: ToolDefinition[];
  onText?: (text: string) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (callId: string, result: string) => void;
}

export interface ExecutionResult {
  content: string;
  toolCallCount: number;
  usage: { inputTokens: number; outputTokens: number };
}

export async function runExecutionLoop(options: ExecutionOptions): Promise<ExecutionResult> {
  const { provider, model, sessionId, systemPrompt, tools, onText, onToolCall, onToolResult } = options;
  const messages = [...options.messages];

  let totalContent = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolCallCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response: ProviderResponse;
    try {
      response = await provider.complete({
        model,
        messages,
        systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
        maxTokens: 4096,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ provider: provider.id, error: msg }, "Provider call failed");
      markProviderFailed(provider.id);
      throw err;
    }

    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;

    if (response.content) {
      totalContent += response.content;
      onText?.(response.content);
    }

    // No tool calls → done
    if (response.toolCalls.length === 0 || response.stopReason !== "tool_use") {
      break;
    }

    // Process tool calls
    // Append assistant message with tool calls to history
    messages.push({
      role: "assistant",
      content: response.content || `[tool_use: ${response.toolCalls.map((t) => t.name).join(", ")}]`,
    });

    for (const call of response.toolCalls) {
      toolCallCount++;
      onToolCall?.(call);

      // Persist tool_use to session
      appendMessage(sessionId, "tool_use", JSON.stringify(call), {
        toolCallId: call.id,
        toolName: call.name,
      });

      const result = await executeTool(call);
      onToolResult?.(call.id, result);

      // Persist tool_result to session
      appendMessage(sessionId, "tool_result", result, {
        toolCallId: call.id,
        toolName: call.name,
      });

      // Feed result back to LLM
      messages.push({
        role: "tool",
        content: result,
        toolCallId: call.id,
        name: call.name,
      });
    }

    log.info({ round, toolCalls: response.toolCalls.length }, "Tool round complete");
  }

  return {
    content: totalContent,
    toolCallCount,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
  };
}
