/**
 * Tests for providers/openrouter.ts
 *
 * OpenRouter wraps the OpenAI SDK with attribution headers and a custom base
 * URL.  We mock the openai module so no real HTTP calls are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture constructor arguments so we can assert on baseURL and headers.
interface ConstructorArgs {
  apiKey: string;
  baseURL: string;
  defaultHeaders: Record<string, string>;
}
const ctorArgs: ConstructorArgs[] = [];

const mockCreate = vi.fn();

vi.mock("openai", () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
    constructor(opts: ConstructorArgs) {
      ctorArgs.push(opts);
    }
  }
  return { default: MockOpenAI };
});

// Mock createOpenAIProvider to prevent it from being invoked with the real SDK
vi.mock("../providers/openai.js", () => ({
  createOpenAIProvider: vi.fn(() => ({
    id: "openai",
    name: "OpenAI",
    async *stream() { yield { type: "done" as const }; },
    async complete() {
      return { content: "", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end_turn" as const };
    },
  })),
}));

import { createOpenRouterProvider } from "../providers/openrouter.js";

describe("providers/openrouter", () => {
  beforeEach(() => {
    ctorArgs.length = 0;
    vi.clearAllMocks();
  });

  it("returns a provider with id 'openrouter' and name 'OpenRouter'", () => {
    const provider = createOpenRouterProvider("sk-or-test");
    expect(provider.id).toBe("openrouter");
    expect(provider.name).toBe("OpenRouter");
  });

  it("constructs the OpenAI client with the OpenRouter base URL", () => {
    createOpenRouterProvider("sk-or-test");
    const args = ctorArgs[0];
    expect(args?.baseURL).toBe("https://openrouter.ai/api/v1");
  });

  it("passes the HTTP-Referer attribution header", () => {
    createOpenRouterProvider("sk-or-test");
    const args = ctorArgs[0];
    expect(args?.defaultHeaders["HTTP-Referer"]).toBeTruthy();
  });

  it("passes the X-Title attribution header", () => {
    createOpenRouterProvider("sk-or-test");
    const args = ctorArgs[0];
    expect(args?.defaultHeaders["X-Title"]).toBeTruthy();
  });

  it("exposes stream() and complete() methods", () => {
    const provider = createOpenRouterProvider("sk-or-test");
    expect(typeof provider.stream).toBe("function");
    expect(typeof provider.complete).toBe("function");
  });
});
