/**
 * Tests for providers/google.ts
 * All HTTP calls are mocked via vi.stubGlobal("fetch", ...).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGoogleProvider } from "../providers/google.js";
import type { ProviderOptions } from "../providers/base.js";

const BASE_OPTIONS: ProviderOptions = {
  model: "gemini-1.5-flash",
  messages: [{ role: "user", content: "Hello" }],
  systemPrompt: "You are helpful.",
};

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createGoogleProvider: provider identity", () => {
  it("has id=google and name=Google", () => {
    const provider = createGoogleProvider("test-key");
    expect(provider.id).toBe("google");
    expect(provider.name).toBe("Google");
  });

  it("exposes stream and complete methods", () => {
    const provider = createGoogleProvider("test-key");
    expect(typeof provider.stream).toBe("function");
    expect(typeof provider.complete).toBe("function");
  });
});

describe("createGoogleProvider: complete()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the correct generateContent URL with the API key", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      makeJsonResponse({
        candidates: [{ content: { parts: [{ text: "Hi there!" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    );

    const provider = createGoogleProvider("my-api-key");
    await provider.complete(BASE_OPTIONS);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain("gemini-1.5-flash:generateContent");
    expect(url).toContain("key=my-api-key");
  });

  it("returns text content from the response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeJsonResponse({
        candidates: [{ content: { parts: [{ text: "Hello world" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 },
      }),
    );

    const provider = createGoogleProvider("k");
    const result = await provider.complete(BASE_OPTIONS);
    expect(result.content).toBe("Hello world");
    expect(result.stopReason).toBe("end_turn");
  });

  it("maps FUNCTION_CALL finishReason to tool_use stopReason", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeJsonResponse({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "my_tool", args: { x: 1 } } }],
            },
            finishReason: "FUNCTION_CALL",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
      }),
    );

    const provider = createGoogleProvider("k");
    const result = await provider.complete(BASE_OPTIONS);
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("my_tool");
    expect(result.toolCalls[0].input).toEqual({ x: 1 });
  });

  it("reports usage tokens", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeJsonResponse({
        candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
      }),
    );

    const provider = createGoogleProvider("k");
    const result = await provider.complete(BASE_OPTIONS);
    expect(result.usage.inputTokens).toBe(20);
    expect(result.usage.outputTokens).toBe(10);
  });

  it("throws when the API returns a non-2xx status", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Bad Request", { status: 400 }),
    );

    const provider = createGoogleProvider("bad-key");
    await expect(provider.complete(BASE_OPTIONS)).rejects.toThrow(/Google API error 400/);
  });
});

describe("createGoogleProvider: stream()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the streamGenerateContent SSE endpoint", async () => {
    const sseLine = `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    })}\n\n`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseLine));
        controller.close();
      },
    });

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const provider = createGoogleProvider("key-stream");
    const deltas = [];
    for await (const delta of provider.stream(BASE_OPTIONS)) {
      deltas.push(delta);
    }

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain("streamGenerateContent");
    expect(url).toContain("alt=sse");
    const textDeltas = deltas.filter((d) => d.type === "text");
    expect(textDeltas.length).toBeGreaterThan(0);
  });
});
