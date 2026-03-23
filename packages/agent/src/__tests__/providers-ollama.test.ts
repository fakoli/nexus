/**
 * Tests for providers/ollama.ts
 *
 * Ollama is a local provider: no API key required, base URL configurable via
 * options or OLLAMA_BASE_URL env var.  We mock createOpenAIProvider so no
 * real HTTP calls are made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const capturedCalls: Array<{ apiKey: string; baseURL: string | undefined }> = [];

vi.mock("../providers/openai.js", () => ({
  createOpenAIProvider: vi.fn((apiKey: string, baseURL?: string) => {
    capturedCalls.push({ apiKey, baseURL });
    return {
      id: "openai",
      name: "OpenAI",
      async *stream() { yield { type: "done" as const }; },
      async complete() {
        return { content: "ok", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn" as const };
      },
    };
  }),
}));

import { createOllamaProvider, OLLAMA_DEFAULT_MODEL } from "../providers/ollama.js";

describe("providers/ollama", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    capturedCalls.length = 0;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_API_KEY;
  });

  afterEach(() => {
    process.env.OLLAMA_BASE_URL = savedEnv.OLLAMA_BASE_URL;
    process.env.OLLAMA_API_KEY = savedEnv.OLLAMA_API_KEY;
  });

  it("returns a provider with id 'ollama' and name 'Ollama'", () => {
    const provider = createOllamaProvider();
    expect(provider.id).toBe("ollama");
    expect(provider.name).toBe("Ollama");
  });

  it("uses the default base URL when no override is provided", () => {
    createOllamaProvider();
    expect(capturedCalls[0]?.baseURL).toBe("http://localhost:11434/v1");
  });

  it("uses the baseUrl option when explicitly provided", () => {
    createOllamaProvider({ baseUrl: "http://remote-host:11434/v1" });
    expect(capturedCalls[0]?.baseURL).toBe("http://remote-host:11434/v1");
  });

  it("uses OLLAMA_BASE_URL env var when set", () => {
    process.env.OLLAMA_BASE_URL = "http://env-host:11434/v1";
    createOllamaProvider();
    expect(capturedCalls[0]?.baseURL).toBe("http://env-host:11434/v1");
  });

  it("exports OLLAMA_DEFAULT_MODEL as 'llama3.2'", () => {
    expect(OLLAMA_DEFAULT_MODEL).toBe("llama3.2");
  });
});
