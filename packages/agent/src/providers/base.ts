/**
 * Provider abstraction — unified interface for all LLM providers.
 *
 * Each provider implements stream() which yields content/tool-use deltas.
 * This replaces OpenClaw's inconsistent per-provider stream wrapper pattern.
 */

export interface ProviderMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderOptions {
  model: string;
  messages: ProviderMessage[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export type StreamDelta =
  | { type: "text"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_delta"; id: string; input: string }
  | { type: "tool_use_end"; id: string }
  | { type: "done"; usage?: { inputTokens: number; outputTokens: number } };

export interface ProviderResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "error";
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface Provider {
  id: string;
  name: string;
  stream(options: ProviderOptions): AsyncGenerator<StreamDelta>;
  complete(options: ProviderOptions): Promise<ProviderResponse>;
}
