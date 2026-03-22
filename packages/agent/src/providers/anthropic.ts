import Anthropic from "@anthropic-ai/sdk";
import type {
  Provider,
  ProviderOptions,
  ProviderResponse,
  StreamDelta,
  ToolCall,
} from "./base.js";

export function createAnthropicProvider(apiKey: string): Provider {
  const client = new Anthropic({ apiKey });

  return {
    id: "anthropic",
    name: "Anthropic",

    async *stream(options: ProviderOptions): AsyncGenerator<StreamDelta> {
      const stream = client.messages.stream({
        model: options.model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        system: options.systemPrompt,
        messages: options.messages.map((m) => ({
          role: m.role === "system" ? "user" : m.role === "tool" ? "user" : m.role,
          content:
            m.role === "tool"
              ? [{ type: "tool_result" as const, tool_use_id: m.toolCallId!, content: m.content }]
              : m.content,
        })),
        tools: options.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        })),
      });

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "tool_use") {
            yield { type: "tool_use_start", id: block.id, name: block.name };
          }
        } else if (event.type === "content_block_delta") {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            yield { type: "text", text: delta.text };
          } else if (delta.type === "input_json_delta") {
            yield {
              type: "tool_use_delta",
              id: "", // filled by caller from context
              input: delta.partial_json,
            };
          }
        } else if (event.type === "content_block_stop") {
          // May be tool_use end — caller tracks this
        } else if (event.type === "message_delta") {
          // Final usage
        }
      }

      const finalMessage = await stream.finalMessage();
      yield {
        type: "done",
        usage: {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
        },
      };
    },

    async complete(options: ProviderOptions): Promise<ProviderResponse> {
      const response = await client.messages.create({
        model: options.model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        system: options.systemPrompt,
        messages: options.messages.map((m) => ({
          role: m.role === "system" ? "user" : m.role === "tool" ? "user" : m.role,
          content:
            m.role === "tool"
              ? [{ type: "tool_result" as const, tool_use_id: m.toolCallId!, content: m.content }]
              : m.content,
        })),
        tools: options.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        })),
      });

      let content = "";
      const toolCalls: ToolCall[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          content += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      let stopReason: ProviderResponse["stopReason"] = "end_turn";
      if (response.stop_reason === "tool_use") stopReason = "tool_use";
      else if (response.stop_reason === "max_tokens") stopReason = "max_tokens";

      return {
        content,
        toolCalls,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        stopReason,
      };
    },
  };
}
