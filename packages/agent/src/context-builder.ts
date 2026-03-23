/**
 * Context builder — assembles the system prompt and message history.
 *
 * This is one of 6 composable units replacing OpenClaw's 3,212-line attempt.ts.
 * Responsibility: build the prompt. Nothing else.
 */
import { getMessages, createLogger, loadBootstrapContent } from "@nexus/core";
import type { ProviderMessage, ToolDefinition } from "./providers/base.js";

const log = createLogger("agent:context");

const DEFAULT_SYSTEM_PROMPT = `You are Nexus, a helpful personal AI assistant.
You can use tools when they would help answer the user's request.
Be concise and direct. Focus on being genuinely helpful.`;

export interface ContextOptions {
  sessionId: string;
  agentId?: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxHistoryMessages?: number;
}

export interface BuiltContext {
  systemPrompt: string;
  messages: ProviderMessage[];
  tools: ToolDefinition[];
}

export function buildContext(options: ContextOptions): BuiltContext {
  const { sessionId, agentId, maxHistoryMessages = 100 } = options;

  const bootstrapContent = loadBootstrapContent(agentId);
  const base = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const systemPrompt = bootstrapContent ? `${bootstrapContent}\n\n${base}` : base;
  const tools = options.tools ?? [];

  // Load message history from SQLite
  const dbMessages = getMessages(sessionId, maxHistoryMessages);

  const messages: ProviderMessage[] = dbMessages.map((m) => {
    const meta = m.metadata as Record<string, unknown> | undefined;
    const toolCallId = typeof meta?.toolCallId === "string" ? meta.toolCallId : undefined;
    const name = typeof meta?.toolName === "string" ? meta.toolName : undefined;
    const role: ProviderMessage["role"] =
      m.role === "tool_use" ? "assistant" : m.role === "tool_result" ? "tool" : (m.role as ProviderMessage["role"]);
    return { role, content: m.content, toolCallId, name };
  });

  log.debug({ sessionId, messageCount: messages.length, toolCount: tools.length }, "Context built");

  return { systemPrompt, messages, tools };
}
