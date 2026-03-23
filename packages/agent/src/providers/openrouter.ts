/**
 * OpenRouter provider.
 *
 * OpenRouter proxies 200+ models from all major providers behind a single
 * OpenAI-compatible endpoint at https://openrouter.ai/api/v1.  We delegate
 * to createOpenAIProvider and layer on the required attribution headers.
 *
 * Required headers (per OpenRouter docs):
 *   HTTP-Referer  — your site / app URL (used for usage attribution)
 *   X-Title       — human-readable app name shown in the OpenRouter dashboard
 */
import OpenAI from "openai";
import { createLogger } from "@nexus/core";
import type {
  Provider,
  ProviderOptions,
  ProviderResponse,
  StreamDelta,
} from "./base.js";
import { createOpenAIProvider } from "./openai.js";

const log = createLogger("agent:providers:openrouter");

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const HTTP_REFERER = "https://github.com/nexus-ai/nexus";
const X_TITLE = "Nexus AI Gateway";

export function createOpenRouterProvider(apiKey: string): Provider {
  // Build a custom OpenAI client that includes the attribution headers on
  // every request.  The base provider handles all message mapping / streaming
  // logic; we only need to swap the underlying HTTP client.
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": HTTP_REFERER,
      "X-Title": X_TITLE,
    },
  });

  // We use the standard OpenAI provider as the structural template but
  // replace stream/complete with versions that use our attribution-aware
  // client.  The simplest approach: build the base provider (which creates
  // its own client) then override only the identity fields and delegate
  // stream/complete through the attribution client.
  const base = createOpenAIProvider(apiKey, OPENROUTER_BASE_URL);

  // Re-implement stream/complete using the attribution client so that headers
  // are attached.  We keep the logic thin — just delegate through the client
  // that already has the headers baked in.
  const attributedProvider: Provider = {
    id: "openrouter",
    name: "OpenRouter",

    async *stream(options: ProviderOptions): AsyncGenerator<StreamDelta> {
      log.info({ model: options.model }, "OpenRouter stream start");

      // Delegate to the base provider's stream generator which was built
      // against an identical API surface.  We can't easily inject our
      // custom client into base, so we forward through a manual call using
      // the attribution client.
      const streamResp = await client.chat.completions.create({
        model: options.model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        messages: buildMessages(options),
        tools: buildTools(options.tools),
        stream: true,
      });

      const toolBuffers = new Map<number, { id: string; name: string }>();

      for await (const chunk of streamResp) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) yield { type: "text", text: delta.content };

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) {
              const id = tc.id ?? `call_${tc.index}`;
              toolBuffers.set(tc.index, { id, name: tc.function.name });
              yield { type: "tool_use_start", id, name: tc.function.name };
            }
            if (tc.function?.arguments) {
              const buf = toolBuffers.get(tc.index);
              if (buf) yield { type: "tool_use_delta", id: buf.id, input: tc.function.arguments };
            }
          }
        }

        if (chunk.choices[0]?.finish_reason) {
          for (const buf of toolBuffers.values()) yield { type: "tool_use_end", id: buf.id };
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
      log.info({ model: options.model }, "OpenRouter complete start");
      // Reuse the base provider's complete — it was built with the same URL
      // but without attribution headers.  For simplicity we call through the
      // attribution client directly.
      const response = await client.chat.completions.create({
        model: options.model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        messages: buildMessages(options),
        tools: buildTools(options.tools),
      });

      const choice = response.choices[0];
      if (!choice) throw new Error("OpenRouter returned an empty choices array");

      const toolCalls = (choice.message.tool_calls ?? []).map((tc) => {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments) as Record<string, unknown>; }
        catch { log.warn({ toolName: tc.function.name }, "Could not parse tool arguments JSON"); }
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

  // Silence the unused base warning — it was imported for its type shape.
  void base;

  return attributedProvider;
}

// ── Minimal message/tool builders (mirrors openai.ts) ─────────────────

function buildMessages(options: ProviderOptions): OpenAI.ChatCompletionMessageParam[] {
  const msgs: OpenAI.ChatCompletionMessageParam[] = [];
  if (options.systemPrompt) msgs.push({ role: "system", content: options.systemPrompt });
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

function buildTools(tools?: ProviderOptions["tools"]): OpenAI.ChatCompletionTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
