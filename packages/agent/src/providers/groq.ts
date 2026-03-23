/**
 * Groq provider.
 *
 * Groq exposes an OpenAI-compatible API, so we simply delegate to
 * createOpenAIProvider with the Groq base URL and override the provider
 * identity fields so the resolver and audit logs reflect the real vendor.
 */
import type { Provider } from "./base.js";
import { createOpenAIProvider } from "./openai.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export function createGroqProvider(apiKey: string): Provider {
  const base = createOpenAIProvider(apiKey, GROQ_BASE_URL);
  return {
    ...base,
    id: "groq",
    name: "Groq",
  };
}
