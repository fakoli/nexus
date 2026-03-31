/**
 * Embedding service abstraction.
 *
 * Defines the EmbeddingProvider interface and concrete implementations
 * for Ollama and OpenAI, plus a factory for creating providers by config.
 */

import { createLogger } from "@nexus/core";
import { z } from "zod";

const log = createLogger("rag:embeddings");

// ── Interface ─────────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  id: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

// ── Factory config schema ─────────────────────────────────────────────────────

export const EmbeddingProviderConfigSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

export type EmbeddingProviderConfig = z.infer<typeof EmbeddingProviderConfigSchema>;

// ── Ollama provider ───────────────────────────────────────────────────────────

const OllamaEmbedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number())),
});

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id = "ollama";
  readonly dimensions: number;

  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options?: { model?: string; baseUrl?: string; dimensions?: number }) {
    this.model = options?.model ?? "nomic-embed-text";
    this.baseUrl = options?.baseUrl ?? "http://localhost:11434";
    this.dimensions = options?.dimensions ?? 768;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const url = `${this.baseUrl}/api/embed`;
    log.info({ model: this.model, count: texts.length }, "Ollama embed request");

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Ollama embed request failed: ${msg}`);
    }

    if (!response.ok) {
      throw new Error(`Ollama embed HTTP ${response.status}: ${await response.text()}`);
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Ollama embed response parse error: ${msg}`);
    }

    const parsed = OllamaEmbedResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Ollama embed response schema error: ${parsed.error.message}`);
    }

    return parsed.data.embeddings;
  }
}

// ── OpenAI provider ───────────────────────────────────────────────────────────

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = "openai";
  readonly dimensions = 1536;

  private readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string | undefined;

  constructor(options?: { model?: string; apiKey?: string; baseUrl?: string }) {
    this.model = options?.model ?? "text-embedding-3-small";
    this.apiKey = options?.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
    this.baseUrl = options?.baseUrl;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    log.info({ model: this.model, count: texts.length }, "OpenAI embed request");

    // Import openai lazily to avoid load-time errors when key is absent
    const { default: OpenAI } = await import("openai");

    const client = new OpenAI({
      apiKey: this.apiKey,
      ...(this.baseUrl ? { baseURL: this.baseUrl } : {}),
    });

    const response = await client.embeddings.create({
      model: this.model,
      input: texts,
    });

    return response.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig,
): EmbeddingProvider {
  const parsed = EmbeddingProviderConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid embedding provider config: ${parsed.error.message}`);
  }

  const { provider, model, apiKey, baseUrl } = parsed.data;

  switch (provider) {
    case "ollama":
      return new OllamaEmbeddingProvider({ model, baseUrl });
    case "openai":
      return new OpenAIEmbeddingProvider({ model, apiKey, baseUrl });
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}
