import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Helpers to build mock fetch responses
// ---------------------------------------------------------------------------

function mockJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    json: async () => data,
  };
}

const VALID_REGISTRY = {
  version: 1,
  plugins: [
    {
      id: "my-telegram",
      name: "Telegram Channel",
      description: "Adds Telegram support",
      version: "1.2.0",
      author: "fakoli",
      repository: "https://github.com/fakoli/fakoli-plugins",
      path: "plugins/my-telegram",
      downloads: 500,
      verified: true,
    },
    {
      id: "my-openai",
      name: "OpenAI Provider",
      description: "Adds OpenAI as a provider",
      version: "0.9.1",
      author: "fakoli",
      repository: "https://github.com/fakoli/fakoli-plugins",
      path: "plugins/my-openai",
    },
  ],
};

const VALID_MANIFEST = {
  id: "my-telegram",
  name: "Telegram Channel",
  version: "1.2.0",
  description: "Adds Telegram support",
  author: "fakoli",
  repository: "https://github.com/fakoli/fakoli-plugins",
  main: "src/index.ts",
  nexus: {
    minVersion: "0.1.0",
    type: "channel",
    capabilities: ["messaging"],
  },
};

describe("marketplace: githubRawBase / githubTarballUrl", () => {
  it("converts a GitHub URL to a raw.githubusercontent base", async () => {
    const { githubRawBase } = await import("../marketplace.js");
    expect(githubRawBase("https://github.com/fakoli/fakoli-plugins")).toBe(
      "https://raw.githubusercontent.com/fakoli/fakoli-plugins/HEAD",
    );
  });

  it("strips trailing slash from repo URL", async () => {
    const { githubRawBase } = await import("../marketplace.js");
    expect(githubRawBase("https://github.com/fakoli/fakoli-plugins/")).toBe(
      "https://raw.githubusercontent.com/fakoli/fakoli-plugins/HEAD",
    );
  });

  it("strips .git suffix from repo URL", async () => {
    const { githubRawBase } = await import("../marketplace.js");
    expect(githubRawBase("https://github.com/fakoli/fakoli-plugins.git")).toBe(
      "https://raw.githubusercontent.com/fakoli/fakoli-plugins/HEAD",
    );
  });

  it("throws for a non-GitHub URL", async () => {
    const { githubRawBase } = await import("../marketplace.js");
    expect(() => githubRawBase("https://gitlab.com/foo/bar")).toThrow(/Not a valid GitHub/);
  });

  it("builds a tarball URL with the GitHub API format", async () => {
    const { githubTarballUrl } = await import("../marketplace.js");
    expect(githubTarballUrl("https://github.com/fakoli/fakoli-plugins")).toBe(
      "https://api.github.com/repos/fakoli/fakoli-plugins/tarball/HEAD",
    );
  });
});

describe("marketplace: fetchRegistry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches and parses a valid registry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse(VALID_REGISTRY)));
    const { fetchRegistry } = await import("../marketplace.js");
    const registry = await fetchRegistry("https://github.com/fakoli/fakoli-plugins");
    expect(registry.version).toBe(1);
    expect(registry.plugins).toHaveLength(2);
    expect(registry.plugins[0].id).toBe("my-telegram");
    vi.unstubAllGlobals();
  });

  it("throws when the HTTP response is not OK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse({}, 404)));
    const { fetchRegistry } = await import("../marketplace.js");
    await expect(fetchRegistry("https://github.com/fakoli/fakoli-plugins")).rejects.toThrow(
      /HTTP 404/,
    );
    vi.unstubAllGlobals();
  });

  it("throws when registry JSON fails schema validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockJsonResponse({ plugins: "not-an-array" })),
    );
    const { fetchRegistry } = await import("../marketplace.js");
    await expect(fetchRegistry("https://github.com/fakoli/fakoli-plugins")).rejects.toThrow(
      /Invalid registry format/,
    );
    vi.unstubAllGlobals();
  });

  it("fetches the correct raw.githubusercontent URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(VALID_REGISTRY));
    vi.stubGlobal("fetch", mockFetch);
    const { fetchRegistry } = await import("../marketplace.js");
    await fetchRegistry("https://github.com/fakoli/fakoli-plugins");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/fakoli/fakoli-plugins/HEAD/registry.json",
      expect.any(Object),
    );
    vi.unstubAllGlobals();
  });
});

describe("marketplace: getPluginDetails", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches and validates a plugin manifest", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse(VALID_MANIFEST)));
    const { getPluginDetails } = await import("../marketplace.js");
    const manifest = await getPluginDetails(
      "https://github.com/fakoli/fakoli-plugins",
      "plugins/my-telegram",
    );
    expect(manifest.id).toBe("my-telegram");
    expect(manifest.nexus.type).toBe("channel");
    vi.unstubAllGlobals();
  });

  it("throws when manifest fails Zod validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockJsonResponse({ id: "bad id with spaces", version: "nope" })),
    );
    const { getPluginDetails } = await import("../marketplace.js");
    await expect(
      getPluginDetails("https://github.com/fakoli/fakoli-plugins", "plugins/bad"),
    ).rejects.toThrow(/Invalid plugin manifest/);
    vi.unstubAllGlobals();
  });

  it("throws on 404 for plugin manifest", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse({}, 404)));
    const { getPluginDetails } = await import("../marketplace.js");
    await expect(
      getPluginDetails("https://github.com/fakoli/fakoli-plugins", "plugins/missing"),
    ).rejects.toThrow(/HTTP 404/);
    vi.unstubAllGlobals();
  });
});

describe("marketplace: searchPlugins", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns all plugins when query is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse(VALID_REGISTRY)));
    const { searchPlugins } = await import("../marketplace.js");
    const results = await searchPlugins("", ["https://github.com/fakoli/fakoli-plugins"]);
    expect(results).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("filters plugins by name (case-insensitive)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse(VALID_REGISTRY)));
    const { searchPlugins } = await import("../marketplace.js");
    const results = await searchPlugins("telegram", ["https://github.com/fakoli/fakoli-plugins"]);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("my-telegram");
    vi.unstubAllGlobals();
  });

  it("filters plugins by description", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse(VALID_REGISTRY)));
    const { searchPlugins } = await import("../marketplace.js");
    const results = await searchPlugins("provider", ["https://github.com/fakoli/fakoli-plugins"]);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("my-openai");
    vi.unstubAllGlobals();
  });

  it("returns empty array when query matches nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse(VALID_REGISTRY)));
    const { searchPlugins } = await import("../marketplace.js");
    const results = await searchPlugins("zzznomatch", ["https://github.com/fakoli/fakoli-plugins"]);
    expect(results).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("skips a failing registry and returns results from the others", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse({}, 500)) // first registry fails
      .mockResolvedValueOnce(mockJsonResponse(VALID_REGISTRY)); // second succeeds
    vi.stubGlobal("fetch", mockFetch);
    const { searchPlugins } = await import("../marketplace.js");
    const results = await searchPlugins("", [
      "https://github.com/fakoli/fakoli-plugins",
      "https://github.com/fakoli/fakoli-plugins",
    ]);
    // At least the second registry's plugins come back
    expect(results.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });
});
