import OpenAI from "openai";
import { createLogger } from "@nexus/core";
import type {
  Provider,
  ProviderOptions,
  ProviderResponse,
  StreamDelta,
  ToolCall,
} from "./base.js";

const log = createLogger("agent:providers:openai");

export function createOpenAIProvider(apiKey: string, baseURL?: string): Provider {
  const client = new OpenAI({ apiKey, baseURL });

  function buildMessages(options: ProviderOptions): OpenAI.ChatCompletionMessageParam[] {
    const msgs: OpenAI.ChatCompletionMessageParam[] = [];
    if (options.systemPrompt) {
      msgs.push({ role: "system", content: options.systemPrompt });
    }
    for (const m of options.messages) {
      if (m.role === "tool") {
        msgs.push({ role: "tool", content: m.content, tool_call_id: m.toolCallId! });
      } else if (m.role === "system") {
        msgs.push({ role: "system", content: m.content });
      } else {
        msgs.push({ role: m.role as "user" | "assistant", content: m.content });
      }
    }
    return msgs;
  }

  function buildTools(
    tools?: ProviderOptions["tools"],
  ): OpenAI.ChatCompletionTool[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  return {
    id: "openai",
    name: "OpenAI",

    async *stream(options: ProviderOptions): AsyncGenerator<StreamDelta> {
      const stream = await client.chat.completions.create({
        model: options.model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        messages: buildMessages(options),
        tools: buildTools(options.tools),
        stream: true,
      });

      const toolInputBuffers = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { type: "text", text: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) {
              const id = tc.id ?? `call_${tc.index}`;
              toolInputBuffers.set(tc.index, { id, name: tc.function.name, args: "" });
              yield { type: "tool_use_start", id, name: tc.function.name };
            }
            if (tc.function?.arguments) {
              const buf = toolInputBuffers.get(tc.index);
              if (buf) {
                buf.args += tc.function.arguments;
                yield { type: "tool_use_delta", id: buf.id, input: tc.function.arguments };
              }
            }
          }
        }

        if (chunk.choices[0]?.finish_reason) {
          for (const buf of toolInputBuffers.values()) {
            yield { type: "tool_use_end", id: buf.id };
          }
          yield {
            type: "done",
            usage: chunk.usage
              ? { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens }
              : undefined,
          };
        }
      }
    },

    async complete(options: ProviderOptions): Promise<ProviderResponse> {
      const response = await client.chat.completions.create({
        model: options.model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        messages: buildMessages(options),
        tools: buildTools(options.tools),
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new Error("OpenAI returned an empty choices array");
      }
      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // malformed JSON from the API — treat as empty input and surface name for debugging
          log.warn({ toolName: tc.function.name }, "Could not parse tool arguments JSON");
        }
        return { id: tc.id, name: tc.function.name, input };
      });

      let stopReason: ProviderResponse["stopReason"] = "end_turn";
      if (choice.finish_reason === "tool_calls") stopReason = "tool_use";
      else if (choice.finish_reason === "length") stopReason = "max_tokens";

      return {
        content: choice.message.content ?? "",
        toolCalls,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
        stopReason,
      };
    },
  };
}
