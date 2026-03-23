/**
 * Agent runtime — the top-level orchestrator.
 *
 * Coordinates: context building → provider resolution → execution loop → persistence.
 * This is the public API for running an agent turn.
 */
import {
  appendMessage,
  getOrCreateSession,
  getOrCreateAgent,
  createLogger,
  recordAudit,
  getAllConfig,
  enforcePromptGuard,
} from "@nexus/core";
import { buildContext } from "./context-builder.js";
import { resolveProvider } from "./providers/resolver.js";
import { runExecutionLoop, type ExecutionResult } from "./execution-loop.js";
import { getToolDefinitions } from "./tool-executor.js";
import type { ToolCall } from "./providers/base.js";

const log = createLogger("agent:runtime");

export interface RunOptions {
  sessionId: string;
  agentId?: string;
  userMessage: string;
  systemPrompt?: string;
  provider?: string;
  model?: string;
  onText?: (text: string) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (callId: string, result: string) => void;
}

export interface RunResult {
  content: string;
  sessionId: string;
  messageId: number;
  toolCallCount: number;
  usage: { inputTokens: number; outputTokens: number };
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
  const agentId = options.agentId ?? "default";

  log.info({ sessionId: options.sessionId, agentId }, "Agent run started");
  recordAudit("agent_run_start", "system", { sessionId: options.sessionId, agentId });

  // Ensure agent and session exist
  getOrCreateAgent(agentId);
  getOrCreateSession(options.sessionId, agentId);

  // Enforce prompt guard before processing user input
  const securityConfig = getAllConfig().security;
  enforcePromptGuard(options.userMessage, securityConfig.promptGuard);

  // Persist user message
  appendMessage(options.sessionId, "user", options.userMessage);

  // Build context from session history
  const context = buildContext({
    sessionId: options.sessionId,
    systemPrompt: options.systemPrompt,
    tools: getToolDefinitions(),
  });

  // Resolve provider with failover and run the execution loop
  let result: ExecutionResult;
  try {
    const { provider, model } = resolveProvider(options.provider, options.model);
    log.info({ provider: provider.id, model }, "Provider resolved");

    result = await runExecutionLoop({
      provider,
      model,
      sessionId: options.sessionId,
      systemPrompt: context.systemPrompt,
      messages: context.messages,
      tools: context.tools,
      onText: options.onText,
      onToolCall: options.onToolCall,
      onToolResult: options.onToolResult,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, "Agent run failed");
    const errorId = appendMessage(options.sessionId, "assistant", `Error: ${msg}`);
    return {
      content: `Error: ${msg}`,
      sessionId: options.sessionId,
      messageId: errorId,
      toolCallCount: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  // Persist assistant response
  const messageId = appendMessage(options.sessionId, "assistant", result.content, {
    usage: result.usage,
    toolCallCount: result.toolCallCount,
  });

  log.info(
    { sessionId: options.sessionId, tokens: result.usage, tools: result.toolCallCount },
    "Agent run complete",
  );

  recordAudit("agent_run_complete", "system", {
    sessionId: options.sessionId,
    usage: result.usage,
    toolCallCount: result.toolCallCount,
  });

  return {
    content: result.content,
    sessionId: options.sessionId,
    messageId,
    toolCallCount: result.toolCallCount,
    usage: result.usage,
  };
}
