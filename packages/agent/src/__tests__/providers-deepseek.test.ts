/**
 * Tests for providers/deepseek.ts
 *
 * DeepSeek wraps createOpenAIProvider with a fixed base URL and overrides
 * the provider identity.  We mock the OpenAI module so no real HTTP is made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStream = vi.fn();
const mockComplete = vi.fn();

vi.mock("../providers/openai.js", () => ({
  createOpenAIProvider: vi.fn((_apiKey: string, baseURL?: string) => ({
    id: "openai",
    name: "OpenAI",
    _baseURL: baseURL,
    async *stream() { yield* mockStream(); },
    async complete() { return mockComplete(); },
  })),
}));

import { createDeepSeekProvider, DEEPSEEK_DEFAULT_MODEL } from "../providers/deepseek.js";
import { createOpenAIProvider } from "../providers/openai.js";

describe("providers/deepseek", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a provider with id 'deepseek' and name 'DeepSeek'", () => {
    const provider = createDeepSeekProvider("sk-deepseek-test");
    expect(provider.id).toBe("deepseek");
    expect(provider.name).toBe("DeepSeek");
  });

  it("passes the DeepSeek base URL to createOpenAIProvider", () => {
    createDeepSeekProvider("sk-deepseek-test");
    expect(createOpenAIProvider).toHaveBeenCalledWith(
      "sk-deepseek-test",
      "https://api.deepseek.com/v1",
    );
  });

  it("exposes stream() and complete() from the wrapped OpenAI provider", () => {
    const provider = createDeepSeekProvider("sk-deepseek-test");
    expect(typeof provider.stream).toBe("function");
    expect(typeof provider.complete).toBe("function");
  });

  it("exports DEEPSEEK_DEFAULT_MODEL as 'deepseek-chat'", () => {
    expect(DEEPSEEK_DEFAULT_MODEL).toBe("deepseek-chat");
  });
});
