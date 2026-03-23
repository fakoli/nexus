/**
 * Ollama provider (local).
 *
 * Ollama exposes an OpenAI-compatible API at http://localhost:11434/v1 by
 * default.  Because Ollama runs locally no API key is required — we pass an
 * empty string so the OpenAI SDK is satisfied.  The base URL can be
 * overridden via the OLLAMA_BASE_URL env var or the `baseUrl` parameter for
 * users running Ollama on a remote host.
 */
import type { Provider } from "./base.js";
import { createOpenAIProvider } from "./openai.js";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

/** Default model to request from a local Ollama instance. */
export const OLLAMA_DEFAULT_MODEL = "llama3.2";

export interface OllamaProviderOptions {
  /** Override the Ollama base URL (e.g. a remote host). Falls back to
   *  OLLAMA_BASE_URL env var, then http://localhost:11434/v1. */
  baseUrl?: string;
  /** Optional API key — most local setups don't need one. */
  apiKey?: string;
}

export function createOllamaProvider(options: OllamaProviderOptions = {}): Provider {
  const baseUrl =
    options.baseUrl ??
    process.env.OLLAMA_BASE_URL ??
    DEFAULT_OLLAMA_BASE_URL;

  // Local Ollama instances don't require auth.  Use the caller-supplied key
  // or a placeholder so the OpenAI SDK doesn't reject an empty string header.
  const apiKey =
    options.apiKey ??
    process.env.OLLAMA_API_KEY ??
    "ollama";

  const base = createOpenAIProvider(apiKey, baseUrl);
  return {
    ...base,
    id: "ollama",
    name: "Ollama",
  };
}
