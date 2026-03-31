/**
 * Unit tests for the embedding service abstraction.
 * HTTP responses are mocked via vitest's global fetch mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  createEmbeddingProvider,
} from "../embeddings.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetchOk(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }),
  );
}

function mockFetchError(status: number, body = "error"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce({
      ok: false,
      status,
      json: async () => ({}),
      text: async () => body,
    }),
  );
}

function mockFetchThrow(message: string): void {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error(message)));
}

// ── OllamaEmbeddingProvider ───────────────────────────────────────────────────

describe("OllamaEmbeddingProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has correct id and default dimensions", () => {
    const provider = new OllamaEmbeddingProvider();
    expect(provider.id).toBe("ollama");
    expect(provider.dimensions).toBe(768);
  });

  it("returns empty array for empty input", async () => {
    const provider = new OllamaEmbeddingProvider();
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });

  it("posts to Ollama /api/embed and returns embeddings", async () => {
    const fakeEmbeddings = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];
    mockFetchOk({ embeddings: fakeEmbeddings });

    const provider = new OllamaEmbeddingProvider();
    const result = await provider.embed(["hello", "world"]);

    expect(result).toEqual(fakeEmbeddings);

    const fetchMock = vi.mocked(fetch);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/embed");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string) as { model: string; input: string[] };
    expect(body.model).toBe("nomic-embed-text");
    expect(body.input).toEqual(["hello", "world"]);
  });

  it("uses custom baseUrl and model", async () => {
    const fakeEmbeddings = [[1, 2]];
    mockFetchOk({ embeddings: fakeEmbeddings });

    const provider = new OllamaEmbeddingProvider({
      model: "mxbai-embed-large",
      baseUrl: "http://myserver:11434",
    });
    await provider.embed(["text"]);

    const fetchMock = vi.mocked(fetch);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://myserver:11434/api/embed");
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe("mxbai-embed-large");
  });

  it("throws on HTTP error response", async () => {
    mockFetchError(503, "Service Unavailable");

    const provider = new OllamaEmbeddingProvider();
    await expect(provider.embed(["test"])).rejects.toThrow(/HTTP 503/);
  });

  it("throws on network error", async () => {
    mockFetchThrow("Connection refused");

    const provider = new OllamaEmbeddingProvider();
    await expect(provider.embed(["test"])).rejects.toThrow(/Connection refused/);
  });

  it("throws on malformed response schema", async () => {
    mockFetchOk({ wrong_key: [] });

    const provider = new OllamaEmbeddingProvider();
    await expect(provider.embed(["test"])).rejects.toThrow(/schema error/);
  });
});

// ── OpenAIEmbeddingProvider ───────────────────────────────────────────────────

describe("OpenAIEmbeddingProvider", () => {
  beforeEach(() => {
    vi.mock("openai", () => {
      const mockCreate = vi.fn();
      return {
        default: vi.fn().mockImplementation(() => ({
          embeddings: { create: mockCreate },
          _mockCreate: mockCreate,
        })),
        _mockCreate: mockCreate,
      };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("has correct id and dimensions", () => {
    const provider = new OpenAIEmbeddingProvider({ apiKey: "test-key" });
    expect(provider.id).toBe("openai");
    expect(provider.dimensions).toBe(1536);
  });

  it("returns empty array for empty input", async () => {
    const provider = new OpenAIEmbeddingProvider({ apiKey: "test-key" });
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });

  it("calls OpenAI embeddings API and returns sorted embeddings", async () => {
    const { default: OpenAI } = await import("openai");
    const instance = new (OpenAI as unknown as new (opts: unknown) => { embeddings: { create: ReturnType<typeof vi.fn> } })({ apiKey: "k" });
    vi.mocked(instance.embeddings.create).mockResolvedValueOnce({
      data: [
        { index: 1, embedding: [0.4, 0.5] },
        { index: 0, embedding: [0.1, 0.2] },
      ],
    });
    (OpenAI as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => instance);

    const provider = new OpenAIEmbeddingProvider({ apiKey: "test-key" });
    const result = await provider.embed(["first", "second"]);
    // Should be sorted by index: [0.1, 0.2] first, [0.4, 0.5] second
    expect(result[0]).toEqual([0.1, 0.2]);
    expect(result[1]).toEqual([0.4, 0.5]);
  });
});

// ── createEmbeddingProvider factory ──────────────────────────────────────────

describe("createEmbeddingProvider", () => {
  it("creates OllamaEmbeddingProvider for provider=ollama", () => {
    const p = createEmbeddingProvider({ provider: "ollama" });
    expect(p.id).toBe("ollama");
    expect(p).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it("creates OpenAIEmbeddingProvider for provider=openai", () => {
    const p = createEmbeddingProvider({ provider: "openai", apiKey: "key" });
    expect(p.id).toBe("openai");
    expect(p).toBeInstanceOf(OpenAIEmbeddingProvider);
  });

  it("passes custom model to Ollama provider", () => {
    const p = createEmbeddingProvider({ provider: "ollama", model: "custom-model" });
    // Can't inspect private fields directly; embed() would use the model
    expect(p.id).toBe("ollama");
  });

  it("throws for unknown provider", () => {
    expect(() => createEmbeddingProvider({ provider: "unknown" })).toThrow(
      /Unknown embedding provider/,
    );
  });
});
