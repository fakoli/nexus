/**
 * Google Gemini provider.
 *
 * Uses the REST API directly (no SDK dependency) so we stay lean.
 * Endpoints:
 *   complete → POST .../models/<model>:generateContent?key=<key>
 *   stream   → POST .../models/<model>:streamGenerateContent?alt=sse&key=<key>
 */
import { createLogger } from "@nexus/core";
import type {
  Provider,
  ProviderOptions,
  ProviderResponse,
  StreamDelta,
  ToolCall,
  ToolDefinition,
} from "./base.js";

const log = createLogger("agent:providers:google");

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ── Gemini request shapes (minimal) ─────────────────────────────────

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: [{ text: string }] };
  tools?: [{ function_declarations: GeminiFunctionDeclaration[] }];
}

// ── Mapping helpers ──────────────────────────────────────────────────

function mapMessages(options: ProviderOptions): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const m of options.messages) {
    if (m.role === "system") continue; // handled via systemInstruction
    if (m.role === "tool") {
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name: m.name ?? "tool", response: { output: m.content } } }],
      });
    } else {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      });
    }
  }
  return contents;
}

function mapTools(tools?: ToolDefinition[]): GeminiRequest["tools"] | undefined {
  if (!tools?.length) return undefined;
  return [
    {
      function_declarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

function buildRequest(options: ProviderOptions): GeminiRequest {
  const req: GeminiRequest = { contents: mapMessages(options) };
  if (options.systemPrompt) {
    req.systemInstruction = { parts: [{ text: options.systemPrompt }] };
  }
  const tools = mapTools(options.tools);
  if (tools) req.tools = tools;
  return req;
}

function extractToolCalls(candidate: { content?: { parts?: GeminiPart[] } }): ToolCall[] {
  return (candidate.content?.parts ?? [])
    .filter((p) => p.functionCall)
    .map((p, i) => ({
      id: `gemini-call-${i}`,
      name: p.functionCall!.name,
      input: p.functionCall!.args,
    }));
}

// ── Provider factory ─────────────────────────────────────────────────

export function createGoogleProvider(apiKey: string): Provider {
  async function post(url: string, body: GeminiRequest): Promise<Response> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google API error ${res.status}: ${text}`);
    }
    return res;
  }

  return {
    id: "google",
    name: "Google",

    async *stream(options: ProviderOptions): AsyncGenerator<StreamDelta> {
      const url = `${BASE}/${options.model}:streamGenerateContent?alt=sse&key=${apiKey}`;
      const res = await post(url, buildRequest(options));
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body from Gemini stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json || json === "[DONE]") continue;
          try {
            const chunk = JSON.parse(json) as {
              candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
              usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
            };
            const candidate = chunk.candidates?.[0];
            if (!candidate) continue;
            for (const part of candidate.content?.parts ?? []) {
              if (part.text) yield { type: "text", text: part.text };
              if (part.functionCall) {
                const id = `gemini-call-0`;
                yield { type: "tool_use_start", id, name: part.functionCall.name };
                yield { type: "tool_use_delta", id, input: JSON.stringify(part.functionCall.args) };
                yield { type: "tool_use_end", id };
              }
            }
            if (candidate.finishReason) {
              yield {
                type: "done",
                usage: chunk.usageMetadata
                  ? {
                      inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
                      outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
                    }
                  : undefined,
              };
            }
          } catch (err) {
            log.warn({ err: String(err) }, "Failed to parse Gemini SSE chunk");
          }
        }
      }
    },

    async complete(options: ProviderOptions): Promise<ProviderResponse> {
      const url = `${BASE}/${options.model}:generateContent?key=${apiKey}`;
      const res = await post(url, buildRequest(options));
      const data = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: GeminiPart[] };
          finishReason?: string;
        }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };

      const candidate = data.candidates?.[0];
      let content = "";
      const toolCalls: ToolCall[] = candidate ? extractToolCalls(candidate) : [];

      for (const part of candidate?.content?.parts ?? []) {
        if (part.text) content += part.text;
      }

      const finishReason = candidate?.finishReason ?? "STOP";
      let stopReason: ProviderResponse["stopReason"] = "end_turn";
      if (finishReason === "STOP") stopReason = "end_turn";
      else if (finishReason === "MAX_TOKENS") stopReason = "max_tokens";
      else if (finishReason === "FUNCTION_CALL") stopReason = "tool_use";

      return {
        content,
        toolCalls,
        usage: {
          inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        },
        stopReason,
      };
    },
  };
}
