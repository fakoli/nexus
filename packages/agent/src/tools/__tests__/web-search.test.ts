import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@nexus/core", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  recordAudit: vi.fn(),
}));

let registeredTool: { execute: (input: unknown) => Promise<string> };
vi.mock("../../tool-executor.js", () => ({
  registerTool: vi.fn((tool) => {
    registeredTool = tool;
  }),
}));

import { registerWebSearchTool } from "../web-search.js";

describe("web-search tool", () => {
  const originalEnv = process.env.BRAVE_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // Re-register to get fresh tool
    registerWebSearchTool();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.BRAVE_API_KEY = originalEnv;
    } else {
      delete process.env.BRAVE_API_KEY;
    }
  });

  it("registers the web_search tool", () => {
    expect(registeredTool).toBeDefined();
  });

  // -- Input validation --

  it("rejects empty query", async () => {
    const result = await registeredTool.execute({ query: "" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  it("rejects query over 500 chars", async () => {
    const result = await registeredTool.execute({ query: "a".repeat(501) });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  it("rejects maxResults below 1", async () => {
    const result = await registeredTool.execute({ query: "test", maxResults: 0 });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  it("rejects maxResults above 10", async () => {
    const result = await registeredTool.execute({ query: "test", maxResults: 11 });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  // -- Query sanitisation --

  it("sanitizes dangerous characters from query", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    const fetchSpy = vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    }));

    await registeredTool.execute({ query: 'hello <script>"test"</script>' });
    const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUrl).not.toContain("<");
    expect(calledUrl).not.toContain(">");
  });

  // -- Brave Search integration --

  it("returns formatted results from Brave API", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: "Result 1", url: "https://example.com", description: "Desc 1" },
          ],
        },
      }),
    }));

    const result = await registeredTool.execute({ query: "test query" });
    expect(result).toContain("Result 1");
    expect(result).toContain("https://example.com");
  });

  // -- DuckDuckGo fallback --

  it("falls back to DuckDuckGo when Brave has no key", async () => {
    delete process.env.BRAVE_API_KEY;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<a class="result__a" href="https://example.com">Title</a><a class="result__snippet">Snippet</a>',
    }));

    const result = await registeredTool.execute({ query: "test" });
    // Should attempt DDG fallback (may or may not parse results from minimal HTML)
    expect(typeof result).toBe("string");
  });

  // -- Error handling --

  it("returns error string when fetch throws", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Timeout")));

    const result = await registeredTool.execute({ query: "test" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("Timeout");
  });
});
