/**
 * Tests for providers/groq.ts
 * Verifies the Groq provider delegates correctly to the OpenAI-compatible base.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock createOpenAIProvider before importing groq
vi.mock("../providers/openai.js", () => ({
  createOpenAIProvider: vi.fn((apiKey: string, baseURL?: string) => ({
    id: "openai",
    name: "OpenAI",
    _apiKey: apiKey,
    _baseURL: baseURL,
    async *stream() {
      yield { type: "done" as const };
    },
    async complete() {
      return {
        content: "mock",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: "end_turn" as const,
      };
    },
  })),
}));

import { createGroqProvider } from "../providers/groq.js";
import { createOpenAIProvider } from "../providers/openai.js";

describe("createGroqProvider", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("has id=groq and name=Groq", () => {
    const provider = createGroqProvider("groq-test-key");
    expect(provider.id).toBe("groq");
    expect(provider.name).toBe("Groq");
  });

  it("delegates to createOpenAIProvider with the Groq base URL", () => {
    createGroqProvider("groq-api-key");
    expect(createOpenAIProvider).toHaveBeenCalledOnce();
    const [, baseURL] = vi.mocked(createOpenAIProvider).mock.calls[0] as [string, string];
    expect(baseURL).toContain("api.groq.com");
  });

  it("passes the API key to createOpenAIProvider", () => {
    createGroqProvider("my-groq-key");
    const [apiKey] = vi.mocked(createOpenAIProvider).mock.calls[0] as [string, string];
    expect(apiKey).toBe("my-groq-key");
  });

  it("complete() resolves without throwing", async () => {
    const provider = createGroqProvider("groq-test-key");
    const result = await provider.complete({
      model: "llama3-8b-8192",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result.content).toBe("mock");
  });
});
