/**
 * Streaming execution loop — like execution-loop.ts but uses provider.stream().
 *
 * Yields StreamDelta events to the caller via onDelta() as they arrive.
 * Tool calls are accumulated from streaming deltas and executed on tool_use_end.
 * Falls back to provider.complete() if streaming throws.
 */
import { createLogger, appendMessage } from "@nexus/core";
import type {
  Provider,
  ProviderMessage,
  StreamDelta,
  ToolDefinition,
  ToolCall,
} from "./providers/base.js";
import { executeTool } from "./tool-executor.js";
import { markProviderFailed } from "./providers/resolver.js";
import { shouldCompact, compactHistory, DEFAULT_MAX_TOKENS } from "./compaction.js";

const log = createLogger("agent:streaming-loop");
const MAX_TOOL_ROUNDS = 20;

export interface StreamingOptions {
  provider: Provider;
  model: string;
  sessionId: string;
  systemPrompt: string;
  messages: ProviderMessage[];
  tools: ToolDefinition[];
  onDelta: (delta: StreamDelta) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (callId: string, result: string) => void;
}

export interface StreamingResult {
  content: string;
  toolCallCount: number;
  usage: { inputTokens: number; outputTokens: number };
}

interface PendingToolUse {
  id: string;
  name: string;
  inputJson: string;
}

export async function runStreamingLoop(options: StreamingOptions): Promise<StreamingResult> {
  const { provider, model, sessionId, systemPrompt, tools, onDelta, onToolCall, onToolResult } =
    options;

  const maxTokens = DEFAULT_MAX_TOKENS[provider.id] ?? DEFAULT_MAX_TOKENS.default;
  let messages = [...options.messages];

  let totalContent = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolCallCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Compact history if approaching context limit
    if (shouldCompact(messages, maxTokens)) {
      messages = await compactHistory(provider, model, messages);
    }

    let roundContent = "";
    const pendingTools = new Map<string, PendingToolUse>();
    // Tracks which tool_use id is currently receiving input_json_delta chunks
    let activeToolId = "";

    try {
      for await (const delta of provider.stream({
        model,
        messages,
        systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
        maxTokens: 4096,
      })) {
        if (delta.type === "text") {
          roundContent += delta.text;
          totalContent += delta.text;
          onDelta(delta);
        } else if (delta.type === "tool_use_start") {
          activeToolId = delta.id;
          pendingTools.set(delta.id, { id: delta.id, name: delta.name, inputJson: "" });
        } else if (delta.type === "tool_use_delta") {
          // The provider sets id="" for input_json_delta; use activeToolId
          const toolId = delta.id || activeToolId;
          const pending = pendingTools.get(toolId);
          if (pending) {
            pending.inputJson += delta.input;
          }
        } else if (delta.type === "done") {
          if (delta.usage) {
            totalInputTokens += delta.usage.inputTokens;
            totalOutputTokens += delta.usage.outputTokens;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ provider: provider.id, error: msg, round }, "Streaming failed, falling back to complete()");
      markProviderFailed(provider.id);

      // Fallback: use complete() for this round
      const response = await provider.complete({
        model,
        messages,
        systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
        maxTokens: 4096,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      if (response.content) {
        roundContent = response.content;
        totalContent += response.content;
        onDelta({ type: "text", text: response.content });
      }

      if (response.toolCalls.length === 0 || response.stopReason !== "tool_use") {
        onDelta({ type: "done", usage: response.usage });
        break;
      }

      // Populate pendingTools from complete() response
      for (const tc of response.toolCalls) {
        pendingTools.set(tc.id, {
          id: tc.id,
          name: tc.name,
          inputJson: JSON.stringify(tc.input),
        });
      }
    }

    // Execute any accumulated tool calls
    if (pendingTools.size === 0) {
      onDelta({ type: "done" });
      break;
    }

    // Append assistant turn with tool_use to history
    messages.push({
      role: "assistant",
      content: roundContent || `[tool_use: ${[...pendingTools.values()].map((t) => t.name).join(", ")}]`,
    });

    for (const pending of pendingTools.values()) {
      toolCallCount++;

      let input: Record<string, unknown> = {};
      try {
        input = pending.inputJson ? (JSON.parse(pending.inputJson) as Record<string, unknown>) : {};
      } catch {
        log.warn({ toolId: pending.id, name: pending.name }, "Failed to parse tool input JSON");
      }

      const call: ToolCall = { id: pending.id, name: pending.name, input };
      onToolCall?.(call);

      appendMessage(sessionId, "tool_use", JSON.stringify(call), {
        toolCallId: call.id,
        toolName: call.name,
      });

      const result = await executeTool(call);
      onToolResult?.(call.id, result);

      appendMessage(sessionId, "tool_result", result, {
        toolCallId: call.id,
        toolName: call.name,
      });

      messages.push({
        role: "tool",
        content: result,
        toolCallId: call.id,
        name: call.name,
      });
    }

    log.info({ round, toolCalls: pendingTools.size }, "Streaming tool round complete");
  }

  return {
    content: totalContent,
    toolCallCount,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
  };
}
