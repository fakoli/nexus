/**
 * DeepSeek provider.
 *
 * DeepSeek exposes an OpenAI-compatible API at https://api.deepseek.com/v1,
 * so we delegate to createOpenAIProvider with the DeepSeek base URL and
 * override the identity fields for the resolver and audit logs.
 */
import type { Provider } from "./base.js";
import { createOpenAIProvider } from "./openai.js";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

/** Default model served by DeepSeek. */
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-chat";

export function createDeepSeekProvider(apiKey: string): Provider {
  const base = createOpenAIProvider(apiKey, DEEPSEEK_BASE_URL);
  return {
    ...base,
    id: "deepseek",
    name: "DeepSeek",
  };
}
